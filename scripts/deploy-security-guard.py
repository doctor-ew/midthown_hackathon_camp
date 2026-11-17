"""Deploy the guard against fresh Lambda preimages, with private backups and health gates."""
import argparse
import base64
import hashlib
import io
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import urllib.request
import zipfile

ACCOUNT = '432230020714'
BUCKET = 'langchain-chatbot-dev-serverlessdeploymentbucket-s0mcuokexinn'
FUNCTIONS = ['langchain-chatbot-dev-' + suffix for suffix in
             ['session', 'chatbot', 'translation', 'personalAssistant', 'sentimentAnalysis', 'foxtrot']]
GUARD = 'dist/src/security.js'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def private_run_directory(parent):
    """Never reuse backups or follow a symlink at the requested backup directory."""
    parent = pathlib.Path(parent)
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'Backup directory must be a real directory')
    require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0,
            'Backup directory must be owned by the current user and private (0700)')
    return pathlib.Path(tempfile.mkdtemp(prefix='guard-', dir=parent))


def private_write(path, content):
    # O_EXCL rejects existing files and symlinks; never truncate an earlier backup.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)


def patch_archive(archive, replacement):
    source = zipfile.ZipFile(io.BytesIO(archive))
    require(source.namelist().count(GUARD) == 1, 'Deployed archive must contain exactly one guard')
    require(source.testzip() is None, 'Deployed archive is corrupt')
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as output:
        for item in source.infolist():
            output.writestr(item, replacement if item.filename == GUARD else source.read(item.filename))
    return destination.getvalue()


def prepare(client, replacement, backup, fetch):
    plans = []
    for name in FUNCTIONS:
        current = client.get_function(FunctionName=name)
        config = current['Configuration']
        require(config['Handler'] == 'dist/src/handler.handler' and config['Runtime'] == 'nodejs24.x',
                'Unexpected deployed runtime or handler: ' + name)
        # The package and optimistic revision always come from the same fresh lookup.
        archive = fetch(current['Code']['Location'])
        require(digest(archive) == config['CodeSha256'], 'Deployed archive hash mismatch: ' + name)
        patched = patch_archive(archive, replacement)
        private_write(backup / (name + '.zip'), archive)
        private_write(backup / (name + '.json'), json.dumps(config).encode())
        plans.append({'name': name, 'config': config, 'original': archive, 'patched': patched})
    return plans


def store(s3, archive):
    key = 'serverless/yata-security/' + hashlib.sha256(archive).hexdigest() + '.zip'
    s3.put_object(Bucket=BUCKET, Key=key, Body=archive, ServerSideEncryption='AES256')
    return key


def wait_for_code(client, name, expected):
    client.get_waiter('function_updated_v2').wait(FunctionName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 25})
    config = client.get_function_configuration(FunctionName=name)
    require(config.get('LastUpdateStatus') == 'Successful' and config['CodeSha256'] == digest(expected),
            'Function update/hash check failed: ' + name)
    return config


def smoke(client, name):
    route = name.removeprefix('langchain-chatbot-dev-')
    event = {'path': '/' + route, 'httpMethod': 'POST',
             'headers': {'origin': 'https://doctorew.com', 'Content-Type': 'application/json'},
             'body': '{}', 'requestContext': {'identity': {'sourceIp': '192.0.2.247'}}}
    result = client.invoke(FunctionName=name, Payload=json.dumps(event).encode())
    require(result.get('StatusCode') == 200 and not result.get('FunctionError'), 'Handler failed cold-start/denial smoke: ' + name)
    response = json.loads(result['Payload'].read())
    require(response.get('statusCode') == 403 and
            json.loads(response.get('body', '{}')).get('error') == 'Please complete the verification and try again.',
            'Handler failed verification-denial smoke: ' + name)


def rollout(client, s3, plans):
    changed = []
    try:
        # Session is the first canary; every subsequent function must pass before continuing.
        for plan in plans:
            key = store(s3, plan['patched'])
            # A request can be accepted even when its response is lost. Track attempts first.
            changed.append(plan)
            client.update_function_code(FunctionName=plan['name'], S3Bucket=BUCKET, S3Key=key,
                                        RevisionId=plan['config']['RevisionId'])
            wait_for_code(client, plan['name'], plan['patched'])
            smoke(client, plan['name'])
            print(json.dumps({'function': plan['name'], 'status': 'healthy'}), flush=True)
    except Exception as error:
        failures = []
        for plan in reversed(changed):
            try:
                # Do not revert a concurrent third-party release during recovery.
                client.get_waiter('function_updated_v2').wait(FunctionName=plan['name'], WaiterConfig={'Delay': 2, 'MaxAttempts': 25})
                current = client.get_function_configuration(FunctionName=plan['name'])
                if current['CodeSha256'] == digest(plan['original']):
                    smoke(client, plan['name'])
                    continue
                require(current['CodeSha256'] == digest(plan['patched']), 'Concurrent release prevents automatic rollback')
                key = store(s3, plan['original'])
                client.update_function_code(FunctionName=plan['name'], S3Bucket=BUCKET, S3Key=key,
                                            RevisionId=current['RevisionId'])
                wait_for_code(client, plan['name'], plan['original'])
                smoke(client, plan['name'])
            except Exception:
                failures.append(plan['name'])
        raise RuntimeError('Rollout failed; rollback requires attention: ' + ','.join(failures)
                           if failures else 'Rollout failed; previous packages restored and denial checks passed') from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup-dir', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    root = pathlib.Path(__file__).resolve().parents[1]
    subprocess.run(['npm', 'run', 'build'], cwd=root, check=True)
    replacement = (root / GUARD).read_bytes()
    import boto3
    session = boto3.Session(region_name='us-east-1')
    require(session.client('sts').get_caller_identity()['Account'] == ACCOUNT, 'Unexpected AWS account')
    client = session.client('lambda')
    backup = private_run_directory(args.backup_dir)
    plans = prepare(client, replacement, backup,
                    lambda url: urllib.request.urlopen(url, timeout=30).read())
    print(json.dumps({'apply': args.apply, 'backupDirectory': str(backup), 'functions': FUNCTIONS,
                      'guardSha256': hashlib.sha256(replacement).hexdigest()}), flush=True)
    if args.apply:
        rollout(client, session.client('s3'), plans)


if __name__ == '__main__':
    main()
