"""Ship the guarded buddy retrieval adapter without replacing package dependencies."""
import argparse
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import zipfile

spec=importlib.util.spec_from_file_location('guard',Path(__file__).with_name('deploy-security-guard.py'))
guard=importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
FUNCTION='langchain-chatbot-dev-chatbot'
REPLACE=('dist/src/handler.js','dist/src/security.js','dist/src/buddySafety.js')
ADAPTER='dist/src/episodeRetrieval.js'


def patch(archive,replacements,adapter):
    guard.require(set(replacements)==set(REPLACE),'Unexpected replacement scope')
    source=zipfile.ZipFile(io.BytesIO(archive))
    guard.require(source.testzip() is None,'Corrupt package')
    for name in REPLACE:
        guard.require(source.namelist().count(name)==1,'Missing or duplicated module: '+name)
    guard.require(source.namelist().count(ADAPTER)<=1,'Duplicated adapter')
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            if item.filename==ADAPTER:
                continue
            target.writestr(copy.copy(item),replacements.get(item.filename,source.read(item.filename)))
        target.writestr(ADAPTER,adapter)
    updated=zipfile.ZipFile(io.BytesIO(output.getvalue()))
    for name in source.namelist():
        if name not in (*REPLACE,ADAPTER):
            guard.require(source.read(name)==updated.read(name),'Unrelated package entry changed: '+name)
    return output.getvalue()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--backup-dir',required=True)
    args=parser.parse_args()
    os.umask(0o077)
    root=Path(__file__).resolve().parents[1]
    subprocess.run(['npm','run','build'],cwd=root,check=True)
    adapter=root/'dist/src/episodeRetrieval.bundle.js'
    subprocess.run([str(root/'node_modules/.bin/esbuild'),'src/episodeRetrieval.ts','--bundle','--platform=node','--target=node24','--format=cjs','--outfile='+str(adapter)],cwd=root,check=True)
    import boto3
    session=boto3.Session(region_name='us-east-1')
    guard.require(session.client('sts').get_caller_identity()['Account']==guard.ACCOUNT,'Unexpected account')
    client=session.client('lambda')
    current=client.get_function(FunctionName=FUNCTION)
    config=current['Configuration']
    guard.require(config['Handler']=='dist/src/handler.handler' and config['Runtime']=='nodejs24.x','Unexpected runtime/handler')
    guard.require(config.get('Environment',{}).get('Variables',{}).get('EPISODE_RETRIEVAL_FUNCTION')=='yata-episode-retrieval-pilot-search','IaC bridge configuration missing')
    original=urllib.request.urlopen(current['Code']['Location'],timeout=30).read()
    guard.require(guard.digest(original)==config['CodeSha256'],'Preimage hash mismatch')
    patched=patch(original,{name:(root/name).read_bytes() for name in REPLACE},adapter.read_bytes())
    backup=guard.private_run_directory(args.backup_dir)
    guard.private_write(backup/(FUNCTION+'.zip'),original)
    guard.private_write(backup/(FUNCTION+'.json'),json.dumps(config).encode())
    if args.apply:
        guard.rollout(client,session.client('s3'),[{'name':FUNCTION,'config':config,'original':original,'patched':patched}])
    report={'applied':args.apply,'function':FUNCTION,'backupDirectory':str(backup),'replacedFiles':list(REPLACE),'bundledAdapter':ADAPTER,'originalCodeSha256':config['CodeSha256'],'patchedCodeSha256':guard.digest(patched)}
    guard.private_write(backup/'receipt.json',json.dumps(report,indent=2).encode())
    print(json.dumps(report))


if __name__=='__main__':
    main()
