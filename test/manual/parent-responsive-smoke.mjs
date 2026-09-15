import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=mkdtempSync(join(tmpdir(),'async-parent-smoke-'));
const host=process.env.PI_SMOKE_HOST_PACKAGE;
if(!host) throw Error('Set PI_SMOKE_HOST_PACKAGE to a real installed Pi package (not the unit-test shim).');
const fixture=join(root,'fixture.ts');
const release=join(root,'release');
const entered=join(root,'entered');
mkdirSync(join(root,'agent','agents'),{recursive:true});
writeFileSync(fixture,`
import {existsSync,writeFileSync} from 'node:fs';
import {Type} from 'typebox';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
export default function(pi){
 pi.registerTool({name:'smoke_gate',label:'Gate',description:'Wait for the test parent',parameters:Type.Object({}),async execute(){writeFileSync(${JSON.stringify(entered)},'entered');const until=Date.now()+20000;while(!existsSync(${JSON.stringify(release)})){if(Date.now()>until)throw Error('parent never released child');await new Promise(r=>setTimeout(r,50));}return {content:[{type:'text',text:'child released'}],details:{}};}});
 pi.registerProvider('smoke',{baseUrl:'http://127.0.0.1:1/unused',apiKey:'fixture',api:'smoke-api',models:[{id:'local',name:'Local',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:1000}],streamSimple(model,context){
 const stream=createAssistantMessageEventStream();
 const messages=context.messages;
 const child=messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('CHILD_GATE_TASK'));
 let content,stopReason='stop';
 const results=messages.filter(m=>m.role==='toolResult');
 if(child){if(results.some(m=>m.toolName==='smoke_gate'))content=[{type:'text',text:'child done'}];else {content=[{type:'toolCall',id:'gate',name:'smoke_gate',arguments:{}}];stopReason='toolUse';}}
 else if(messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('NEW_INSTRUCTION'))){content=[{type:'text',text:'parent answered new instruction'}];}
 else if(results.some(m=>m.toolName==='subagent')){content=[{type:'text',text:'parent launch returned'}];}
 else{content=[{type:'toolCall',id:'launch',name:'subagent',arguments:{agent:'smoke-child',task:'CHILD_GATE_TASK',context:'fresh'}}];stopReason='toolUse';}
 const message={role:'assistant',content,api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason,timestamp:Date.now()};queueMicrotask(()=>{stream.push({type:'done',reason:stopReason,message});stream.end();});return stream;
 }});
}
`);
writeFileSync(join(root,'agent','agents','smoke-child.md'),`---\nname: smoke-child\ndescription: Isolated deterministic child\nmodel: smoke/local\ntools: smoke_gate\nsubagentOnlyExtensions:\n  - ${fixture}\n---\nExecute smoke_gate once and report completion.\n`);
const proc=spawn(process.execPath,[join(host,'dist/cli.js'),'--mode','rpc','--session-dir',join(root,'sessions'),'--no-extensions','--no-skills','--no-context-files','--model','smoke/local','-e',fixture,'-e',fileURLToPath(new URL('../../index.ts',import.meta.url))],{cwd:root,env:{PATH:process.env.PATH,HOME:root,PI_CODING_AGENT_DIR:join(root,'agent'),PI_SUBAGENTS_TEMP_ROOT:join(root,'subagents')},stdio:['pipe','pipe','pipe']});
let buffer='',events=[],err='';let resolveSettle;let settle=new Promise(r=>resolveSettle=r);
proc.stderr.on('data',b=>err+=b);proc.stdout.on('data',b=>{buffer+=b;while(buffer.includes('\n')){let i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{let e=JSON.parse(line);events.push(e);if(e.type==='agent_settled')resolveSettle();}catch{}}});
const timer=setTimeout(()=>proc.kill('SIGTERM'),35000);
try{
 proc.stdin.write(JSON.stringify({type:'prompt',message:'Launch one test child'})+'\n');
 await Promise.race([settle,new Promise((_,reject)=>setTimeout(()=>reject(Error('first settle timeout')),20000).unref())]);
 if(!events.some(e=>JSON.stringify(e).includes('parent launch returned')))throw Error('parent did not receive launch');
 if(events.some(e=>e.type==='tool_execution_end'&&e.isError))throw Error('tool error');
 const deadline=Date.now()+10000;while(!existsSync(entered)){if(Date.now()>deadline)throw Error('child not entered');await new Promise(r=>setTimeout(r,50));}
 settle=new Promise(r=>resolveSettle=r);
 proc.stdin.write(JSON.stringify({type:'prompt',message:'NEW_INSTRUCTION'})+'\n');
 await Promise.race([settle,new Promise((_,reject)=>setTimeout(()=>reject(Error('second settle timeout')),5000).unref())]);
 if(!events.some(e=>JSON.stringify(e).includes('parent answered new instruction')))throw Error('no new response');
 if(existsSync(release))throw Error('child released too soon');
 writeFileSync(release,'release');
 const wakeDeadline=Date.now()+10000;
 while(!events.some(e=>e.type==='message_end'&&e.message?.customType==='subagent-notify')){if(Date.now()>wakeDeadline)throw Error('native completion notification missing');await new Promise(r=>setTimeout(r,50));}
 console.log(JSON.stringify({ok:true,root,parentAnsweredBeforeChildReleased:true,nativeCompletionDelivered:true}));
}catch(e){console.log(JSON.stringify({ok:false,root,error:String(e),stderr:err.slice(-3000),lastEvents:events.slice(-4)}));process.exitCode=1;}finally{writeFileSync(join(root,'events.json'),JSON.stringify(events,null,2));clearTimeout(timer);proc.stdin.end();proc.kill('SIGTERM');}
