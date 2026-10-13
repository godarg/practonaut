import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readTabSession,TAB_SESSION_KEY} from '../../src/player/tab-session.ts';
function storage(raw:string){let value:string|null=raw;return{getItem:(_key:string)=>value,setItem:(_key:string,next:string)=>{value=next;},removeItem:()=>{value=null;}};}
const presentation={language:'de',theme:'dark',workspace:'author'};
const v2={schema:'practonaut.tab-session/2',token:'a'.repeat(64),authorToken:'b'.repeat(64),sessionId:'11111111-1111-4111-8111-111111111111',...presentation};
test('v1 cache is removed instead of reinterpreting its credential as author authority',()=>{
  const s=storage(JSON.stringify({schema:'practonaut.tab-session/1',token:'a'.repeat(64),...presentation}));
  assert.equal(readTabSession(()=>s),undefined);assert.equal(s.getItem(TAB_SESSION_KEY),null);
});
test('v2 cache admits distinct held credentials bound to a typed host instance',()=>{
  assert.deepEqual(readTabSession(()=>storage(JSON.stringify(v2))),v2);
  for(const invalid of [{...v2,authorToken:v2.token},{...v2,authorToken:'short'},{...v2,sessionId:''},{...v2,sessionId:'other-host'}, {...v2,unrelatedAuthority:'yes'}]){
    const s=storage(JSON.stringify(invalid));assert.equal(readTabSession(()=>s),undefined);assert.equal(s.getItem(TAB_SESSION_KEY),null);
  }
  const {authorToken:_author,...practice}=v2;assert.deepEqual(readTabSession(()=>storage(JSON.stringify({...practice,workspace:'board'}))),{...practice,workspace:'board'});
});
