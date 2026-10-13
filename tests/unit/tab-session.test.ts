import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TAB_SESSION_KEY,clearTabSession,readTabSession,writeTabSession,type TabSession} from '../../src/player/tab-session.ts';
const value:TabSession={schema:'practonaut.tab-session/2',token:'a'.repeat(64),authorToken:'b'.repeat(64),sessionId:'11111111-1111-4111-8111-111111111111',language:'de',theme:'dark',workspace:'author'};
function store(){const values=new Map<string,string>();return{values,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
test('tab cache restores only bounded well-typed credentials and presentation, never projects or evidence',()=>{
 const storage=store();assert.equal(writeTabSession(value,()=>storage),true);assert.deepEqual(readTabSession(()=>storage),value);
 for(const raw of ['{','null','[]','x'.repeat(1025),JSON.stringify({...value,token:'short'}),JSON.stringify({...value,workspace:['author']}),JSON.stringify({...value,language:['de']}),JSON.stringify({...value,theme:['dark']}),JSON.stringify({...value,project:{confirmed:true}})]){
  storage.setItem(TAB_SESSION_KEY,raw);assert.equal(readTabSession(()=>storage),undefined);assert.equal(storage.getItem(TAB_SESSION_KEY),null);
 }
 writeTabSession(value,()=>storage);clearTabSession(()=>storage);assert.equal(readTabSession(()=>storage),undefined);
});
test('browser storage refusal preserves initial use without inventing restored authority',()=>{
 const denied=()=>{throw new Error('Browser policy denies storage');};
 assert.equal(writeTabSession(value,denied),false);assert.equal(readTabSession(denied),undefined);assert.doesNotThrow(()=>clearTabSession(denied));
 const quota={getItem:()=>null,setItem:()=>{throw new Error('Quota reached');},removeItem:()=>{}};
 assert.equal(writeTabSession(value,()=>quota),false);
});
