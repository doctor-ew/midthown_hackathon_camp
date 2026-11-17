"""Deploy only compiled security guard; retain private rollback archives per function."""
import argparse, base64, hashlib, io, json, os, pathlib, urllib.request, zipfile
import boto3
from concurrent.futures import ThreadPoolExecutor

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true')
parser.add_argument('--backup-dir', required=True)
args = parser.parse_args()
os.umask(0o077)
root = pathlib.Path(__file__).resolve().parents[1]
replacement = (root / 'dist/src/security.js').read_bytes()
session = boto3.Session(region_name='us-east-1')
assert session.client('sts').get_caller_identity()['Account'] == '432230020714'
client = session.client('lambda')
names = ['langchain-chatbot-dev-' + suffix for suffix in ['session','chatbot','translation','personalAssistant','sentimentAnalysis','foxtrot']]
backup = pathlib.Path(args.backup_dir)
backup.mkdir(parents=True, exist_ok=True, mode=0o700)
plans = []
for name in names:
    current = client.get_function(FunctionName=name)
    config = current['Configuration']
    assert config['Handler'] == 'dist/src/handler.handler' and config['Runtime'] == 'nodejs24.x'
    cached = backup / (name + '.zip')
    archive = cached.read_bytes() if cached.exists() else urllib.request.urlopen(current['Code']['Location'], timeout=30).read()
    # Cached archives are the original rollback baseline, even after a partial rollout.
    if not cached.exists():
        assert base64.b64encode(hashlib.sha256(archive).digest()).decode() == config['CodeSha256']
    source = zipfile.ZipFile(io.BytesIO(archive))
    assert 'dist/src/security.js' in source.namelist()
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as output:
        for item in source.infolist():
            output.writestr(item, replacement if item.filename == 'dist/src/security.js' else source.read(item.filename))
    (backup / (name + '.zip')).write_bytes(archive)
    # Configuration contains secrets. It remains in the private rollback directory only.
    config_backup = backup / (name + '.json')
    if not config_backup.exists():
        config_backup.write_text(json.dumps(config))
    plans.append((name, config, destination.getvalue()))
print(json.dumps({'apply': args.apply, 'functions': names, 'guardSha256': hashlib.sha256(replacement).hexdigest()}), flush=True)
if args.apply:
    def deploy(plan):
        name, config, archive = plan
        bucket = 'langchain-chatbot-dev-serverlessdeploymentbucket-s0mcuokexinn'
        key = 'serverless/yata-security/' + hashlib.sha256(archive).hexdigest() + '.zip'
        session.client('s3').put_object(Bucket=bucket, Key=key, Body=archive, ServerSideEncryption='AES256')
        result = client.update_function_code(FunctionName=name, S3Bucket=bucket, S3Key=key, RevisionId=config['RevisionId'])
        client.get_waiter('function_updated_v2').wait(FunctionName=name, WaiterConfig={'Delay':2,'MaxAttempts':25})
        deployed = client.get_function_configuration(FunctionName=name)
        assert deployed['CodeSha256'] == base64.b64encode(hashlib.sha256(archive).digest()).decode()
        print(json.dumps({'function': name, 'status': deployed['LastUpdateStatus'], 'codeSha256': deployed['CodeSha256']}), flush=True)

    with ThreadPoolExecutor(max_workers=6) as executor:
        list(executor.map(deploy, plans))
