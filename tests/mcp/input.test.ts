import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MCP_LIMITS } from '../../src/mcp/server.ts';
test('stdio oversized line returns bounded RPC error then accepts next complete frame',{timeout:10000},async()=>{
  const entry=fileURLToPath(new URL('../../src/mcp/server.ts',import.meta.url));
  const code=`const {startMcpStdio}=await import(${JSON.stringify(entry)});startMcpStdio({call:async()=>({ok:false,error:{code:'invalid_request',message:'fixed'}})});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});let raw='',stderr='';
  child.stdout.on('data',chunk=>{raw+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const wait=async(predicate:()=>boolean)=>{const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw new Error('No bounded RPC response before deadline');await new Promise(resolve=>setTimeout(resolve,20));}};
  try {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'security',version:'1'}}})+'\n');
    await wait(()=>raw.includes('"id":1'));
    child.stdin.write('x'.repeat(MCP_LIMITS.inboundBytes+1)+'\n');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})+'\n');
    await wait(()=>raw.includes('"id":2'));
    const replies=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.ok(replies.some(reply=>reply.id===null&&reply.error?.code===-32600),'oversized frame needs a structured RPC rejection');
    assert.ok(replies.some(reply=>reply.id===2&&reply.result),'a later small frame must still be serviced');
    assert.equal(raw.includes('x'.repeat(100)),false);assert.equal(stderr,'');
  }finally{child.stdin.end();if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}
});
test('fixed tool schema errors are bounded structured project errors',{timeout:10000},async()=>{
  const entry=fileURLToPath(new URL('../../src/mcp/server.ts',import.meta.url));
  const child=spawn(process.execPath,['--input-type=module','-e',`const {startMcpStdio}=await import(${JSON.stringify(entry)});startMcpStdio({call:async()=>({ok:true,value:[]})});`],{stdio:['pipe','pipe','pipe']});let raw='';child.stdout.on('data',chunk=>{raw+=chunk;});
  const wait=async(id:number)=>{const deadline=Date.now()+3000;while(!raw.includes('"id":'+id)){if(Date.now()>deadline)throw new Error('No RPC response');await new Promise(resolve=>setTimeout(resolve,20));}};
  try {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'security',version:'1'}}})+'\n');await wait(1);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'act',arguments:{name:'SECRET_MARKER'}}})+'\n');await wait(3);
    const response=raw.trim().split('\n').map(line=>JSON.parse(line)).find(reply=>reply.id===3);
    assert.equal(response.result?.isError,true);const body=JSON.parse(response.result.content[0].text);assert.equal(body.error.code,'invalid_request');assert.equal(raw.includes('SECRET_MARKER'),false);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'PRIVATE_UNKNOWN_TOOL_MARKER',arguments:{}}})+'\n');await wait(4);
    const unknown=raw.trim().split('\n').map(line=>JSON.parse(line)).find(reply=>reply.id===4);assert.equal(unknown.result?.isError,true);assert.equal(JSON.parse(unknown.result.content[0].text).error.code,'invalid_request');assert.equal(raw.includes('PRIVATE_UNKNOWN_TOOL_MARKER'),false);
  }finally{child.stdin.end();if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}}
});
