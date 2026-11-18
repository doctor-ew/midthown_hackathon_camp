"""Update only companion modules in the current chatbot package; preserve the guard."""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import zipfile

spec = importlib.util.spec_from_file_location('deploy_guard', Path(__file__).with_name('deploy-security-guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
FILES = ('dist/src/channelPlanner.js', 'dist/src/config/personalityMatrix.js')
FUNCTION = 'langchain-chatbot-dev-chatbot'


def patch(archive, replacements):
    guard.require(set(replacements) == set(FILES), 'Unexpected replacement scope')
    source = zipfile.ZipFile(io.BytesIO(archive))
    guard.require(source.testzip() is None, 'Corrupt package')
    guard.require(source.namelist().count(guard.GUARD) == 1, 'Missing or duplicated guard')
    for name in FILES:
        guard.require(source.namelist().count(name) == 1, 'Missing or duplicated companion module: ' + name)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            target.writestr(copy.copy(item), replacements.get(item.filename, source.read(item.filename)))
    result = output.getvalue()
    updated = zipfile.ZipFile(io.BytesIO(result))
    for name in source.namelist():
        if name not in FILES:
            guard.require(source.read(name) == updated.read(name), 'Unrelated package entry changed: ' + name)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup-dir', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    root = Path(__file__).resolve().parents[1]
    subprocess.run(['npm', 'run', 'build'], cwd=root, check=True)
    import boto3
    session = boto3.Session(region_name='us-east-1')
    guard.require(session.client('sts').get_caller_identity()['Account'] == guard.ACCOUNT, 'Unexpected AWS account')
    client = session.client('lambda')
    current = client.get_function(FunctionName=FUNCTION)
    config = current['Configuration']
    guard.require(config['Handler'] == 'dist/src/handler.handler' and config['Runtime'] == 'nodejs24.x', 'Unexpected runtime/handler')
    original = urllib.request.urlopen(current['Code']['Location'], timeout=30).read()
    guard.require(guard.digest(original) == config['CodeSha256'], 'Preimage hash mismatch')
    patched = patch(original, {name: (root / name).read_bytes() for name in FILES})
    backup = guard.private_run_directory(args.backup_dir)
    guard.private_write(backup / (FUNCTION + '.zip'), original)
    guard.private_write(backup / (FUNCTION + '.json'), json.dumps(config).encode())
    if args.apply:
        guard.rollout(client, session.client('s3'), [{'name': FUNCTION, 'config': config, 'original': original, 'patched': patched}])
        deployed = client.get_function(FunctionName=FUNCTION)
        actual = urllib.request.urlopen(deployed['Code']['Location'], timeout=30).read()
        guard.require(guard.digest(actual) == guard.digest(patched), 'Final package mismatch')
    report = {'applied': args.apply, 'function': FUNCTION, 'backupDirectory': str(backup), 'replacedFiles': list(FILES),
              'originalCodeSha256': config['CodeSha256'], 'patchedCodeSha256': guard.digest(patched),
              'guardSha256': hashlib.sha256(zipfile.ZipFile(io.BytesIO(original)).read(guard.GUARD)).hexdigest(),
              'revisionBefore': config['RevisionId']}
    if args.apply:
        report['revisionAfter'] = deployed['Configuration']['RevisionId']
    guard.private_write(backup / 'receipt.json', json.dumps(report, indent=2).encode())
    print(json.dumps(report))


if __name__ == '__main__':
    main()
