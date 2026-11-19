const{test}=require('node:test');const assert=require('node:assert/strict');
const{parseRequest,authorize,configuration}=require('../dist/src/security');
const{routeIntent,validateIntent,INTENT_KINDS}=require('../dist/src/episodeRetrieval');
const event=body=>({path:'/chatbot',httpMethod:'POST',headers:{origin:'https://doctorew.com','content-type':'application/json'},body:JSON.stringify(body),requestContext:{identity:{sourceIp:'192.0.2.1'}}});
const base={mode:'intent',question:"Let's create a channel with He-Man, Battlestar Galactica, and transformers",personality:'twiki',sessionToken:'fixture'};
test('intent contract requires finite buddy identity and unchanged authorization',async()=>{
 assert.equal(parseRequest(event(base)).body.mode,'intent');
 for(const patch of [{question:'x'.repeat(1001)},{personality:'unknown'},{host:'twiki'},{shows:'[]'},{retrievalQuery:'plot'},{language:'English'}])assert.throws(()=>parseRequest(event({...base,...patch})),{statusCode:400});
 await assert.rejects(authorize(event(base),{...configuration({}),secret:'fixture',table:'fixture'},{now:()=>new Date(),verify:async()=>{throw Error('must not call')},transact:async()=>{throw Error('must not call')}}),{statusCode:401});
});
test('only finite confident classification envelopes survive the adapter',async()=>{
 const good={version:1,status:'classified',intent:'build-channel',confidence:.98};assert.deepEqual(await routeIntent(base.question,async()=>good),good);
 for(const patch of [{intent:'https://evil.example'},{confidence:.5},{url:'https://evil.example'},{status:'unavailable',intent:'build-channel'}])assert.throws(()=>validateIntent({...good,...patch}));
 assert.equal((await routeIntent('hello',async()=>{throw Error('offline')})).intent,'clarify');assert.equal((await routeIntent('hello',async()=>({bad:true}))).status,'unavailable');assert.equal(INTENT_KINDS.length,9);
});
