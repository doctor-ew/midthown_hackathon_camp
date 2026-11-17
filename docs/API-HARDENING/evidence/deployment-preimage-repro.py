import io,zipfile,tempfile,pathlib,runpy,sys,types,base64,hashlib,json,contextlib
script=pathlib.Path(__file__).resolve().parents[3] / 'scripts/deploy-security-guard.py'
def archive(handler):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('dist/src/security.js','old guard');z.writestr('dist/src/handler.js',handler)
 return out.getvalue()
old=archive('OLD handler');current=archive('NEW handler');uploaded={};deployed=[]
class Client:
 def get_caller_identity(self):return {'Account':'432230020714'}
 def get_function(self,**kw):return {'Configuration':{'Handler':'dist/src/handler.handler','Runtime':'nodejs24.x','RevisionId':'CURRENT-REV','CodeSha256':base64.b64encode(hashlib.sha256(current).digest()).decode()},'Code':{'Location':'must-fetch-current'}}
 def put_object(self,**kw):uploaded[kw['Key']]=kw['Body']
 def update_function_code(self,**kw):
  data=uploaded[kw['S3Key']];deployed.append(zipfile.ZipFile(io.BytesIO(data)).read('dist/src/handler.js').decode());return {}
 def get_waiter(self,*args):return self
 def wait(self,**kw):pass
 def get_function_configuration(self,**kw):return {'LastUpdateStatus':'Successful','CodeSha256':base64.b64encode(hashlib.sha256(next(iter(uploaded.values()))).digest()).decode()}
client=Client()
sys.modules['boto3']=types.SimpleNamespace(Session=lambda **kw:types.SimpleNamespace(client=lambda name:client))
with tempfile.TemporaryDirectory() as tmp:
 for suffix in ['session','chatbot','translation','personalAssistant','sentimentAnalysis','foxtrot']:
  pathlib.Path(tmp,'langchain-chatbot-dev-'+suffix+'.zip').write_bytes(old)
 sys.argv=[str(script),'--apply','--backup-dir',tmp]
 with contextlib.redirect_stdout(io.StringIO()):runpy.run_path(str(script),run_name='__main__')
 assert len(deployed)==6 and set(deployed)=={'OLD handler'}
 print(json.dumps({'test':'cached rollback archive overwrites newer unrelated deployed code','result':'REPRODUCED','affectedFunctions':len(deployed),'liveAWSCalls':0}))
