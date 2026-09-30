"""Real installed Codex app-server, synthetic Responses. No production model changes."""
import hashlib, json, os, pathlib, re, selectors, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

source = pathlib.Path(__file__).resolve().parents[1]
root = pathlib.Path(tempfile.mkdtemp(prefix='agent-state-native-', dir='/home/penis/tmp'))
env = {**os.environ, 'CODEX_HOME':str(root), 'CODEX_AGENT_STATE_STATE_DIR':str(root/'guide-state')}
phase = 'root'; root_thread = None; requests = []; counts = {}; mode = os.environ.get('AGENT_STATE_PROBE_MODE','code')
SHARED='SHARED_GUIDE_c791_procedure'; PRIVATE='PRIVATE_GUIDE_82d9'; ANCHOR='PRIVATE_PARENT_ANCHOR_11d4'; CHILD='CHILD_GUIDE_19e3'
cp = 'BEGIN_CHILD_ANCHOR\n'+'я'*2000+'\nMIDDLE_CHILD_ANCHOR\n'+'я'*2000+'\nEND_CHILD_ANCHOR'
cp += 'x' * (8192-len(cp.encode()))

def strings(v):
    if isinstance(v,str):return [v]
    if isinstance(v,list):return [s for x in v for s in strings(x)]
    if isinstance(v,dict):return [s for x in v.values() for s in strings(x)]
    return []
def msg(text,n):return {'id':'msg_'+str(n),'type':'message','role':'assistant','content':[{'type':'output_text','text':text}]}
def call(name,args,n,namespace=None):
    result={'id':'fc_'+str(n),'type':'function_call','call_id':'call_'+str(n),'name':name,'arguments':json.dumps(args)}
    if namespace:result['namespace']=namespace
    return result
def code(cmd,n,yielded=False):
    body=('// @exec: {"yield_time_ms": 1}\nawait new Promise(r=>setTimeout(r,100)); ' if yielded else '')+'text(await tools.exec_command('+json.dumps({'cmd':cmd})+'));'
    return {'id':'ct_'+str(n),'type':'custom_tool_call','call_id':'call_'+str(n),'name':'exec','input':body}

class Provider(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        sid=body.get('client_metadata',{}).get('thread_id'); text='\n'.join(strings(body.get('input'))); compact='NATIVE_GUIDE_COMPACT' in text
        key=(sid,compact,phase);counts[key]=counts.get(key,0)+1;n=counts[key];i=len(requests)
        requests.append({'thread':sid,'phase':phase,'compact':compact,'step':n,'shared':SHARED in text,'private':PRIVATE in text,'parent_anchor':ANCHOR in text,'child':CHILD in text,'full_child_anchor':cp in text,'truncated': 'INJECTION TRUNCATED' in text})
        high=False
        if compact:items=[msg('Opaque native fixture summary deliberately omits saved guides.',i)]
        elif sid==root_thread:
            if phase=='children' and n==1:items=[call('spawn_agent',{'task_name':'guide_probe_child','fork_turns':'none','message':'Exercise saved reusable guides.'},i,'collaboration')]
            elif phase=='followup' and n==1:items=[call('followup_task',{'target':'/root/guide_probe_child','message':'Apply the original saved future-action guides again.'},i,'collaboration')]
            elif phase=='auto' and n==1:items=[code('true',i)];high=True
            else:items=[msg('ROOT_DONE',i)]
        elif phase=='followup':items=[msg('CHILD_FOLLOWUP_GUIDED' if CHILD in text and cp in text and PRIVATE not in text and ANCHOR not in text else 'FOLLOWUP_MISSING_GUIDES',i)]
        elif phase!='children':items=[msg('UNRELATED_DONE',i)]
        elif n==1:items=[{'id':'ct_'+str(i),'type':'custom_tool_call','call_id':'call_'+str(i),'name':'exec','input':'text(await tools.mcp__agent_state__agent_state_note('+json.dumps({'title':'Child guide','body':CHILD+' When probing, compare source bytes and read-back.'})+'));'}]
        elif n==2:items=[{'id':'ct_'+str(i),'type':'custom_tool_call','call_id':'call_'+str(i),'name':'exec','input':'text(await tools.mcp__agent_state__agent_state_checkpoint('+json.dumps({'content':cp})+'));'}]
        elif n==3:items=[code('true',i)];high=True
        elif n==4:
            items=[msg('FIRST_CHILD_FINAL',i)] if mode=='final' else [code(f'touch {root}/first-action',i,mode=='yielded')]
        elif mode=='yielded' and n in (5,7):
            cells=re.findall(r'Script running with cell ID ([^\s\\"]+)',text)
            items=[call('wait',{'cell_id':cells[-1],'yield_time_ms':1000},i)] if cells else [msg('NO_CELL',i)]
        elif mode=='final' and n==5:
            # A full 8KiB compatibility guide may truncate other files in
            # SubagentStop's native reason budget. Follow that instruction and
            # read the original guides through runtime-generated locators.
            script='const index=await tools.mcp__agent_state__agent_state_read({}); const data=index.structuredContent ?? JSON.parse(index.content[0].text); const note=data.notes.find(n=>n.title==="Child guide" && n.scope==="own"); if(!note) throw new Error("own original guide absent"); text(data.anchor.content); text(await tools.mcp__agent_state__agent_state_read({note_id:note.note_id}));'
            items=[{'id':'ct_'+str(i),'type':'custom_tool_call','call_id':'call_'+str(i),'name':'exec','input':script}]
        elif n==(6 if mode in ('yielded','final') else 5):items=[code(f'touch {root}/restored-action',i,mode=='yielded')]
        else:items=[msg('CHILD_DONE' if CHILD in text and cp in text else 'MISSING_GUIDES',i)]
        rid='resp_'+str(i);events=[('response.created',{'response':{'id':rid,'status':'in_progress'}})]
        for j,item in enumerate(items):events.extend([('response.output_item.added',{'output_index':j,'item':item}),('response.output_item.done',{'output_index':j,'item':item})])
        events.append(('response.completed',{'response':{'id':rid,'status':'completed','output':items,'usage':{'input_tokens':10000 if high else 100,'output_tokens':10,'total_tokens':10010 if high else 110}}}))
        data=''.join('event: '+k+'\ndata: '+json.dumps({'type':k,**v})+'\n\n' for k,v in events).encode()
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

class Client:
    def __init__(self,client_env=env):
        self.p=subprocess.Popen(['codex','app-server'],env=client_env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=(root/'stderr.log').open('a'))
        self.seq=0;self.buf=b'';self.events=[];self.sel=selectors.DefaultSelector();self.sel.register(self.p.stdout,selectors.EVENT_READ)
    def read(self,timeout=30):
        while b'\n' not in self.buf:
            if not self.sel.select(timeout):raise TimeoutError('native app-server output')
            data=os.read(self.p.stdout.fileno(),65536)
            if not data:raise RuntimeError('native app-server EOF')
            self.buf+=data
        line,self.buf=self.buf.split(b'\n',1);return json.loads(line)
    def req(self,method,params):
        self.seq+=1;target=self.seq;self.p.stdin.write((json.dumps({'jsonrpc':'2.0','id':target,'method':method,'params':params})+'\n').encode());self.p.stdin.flush()
        while True:
            d=self.read()
            if d.get('id')==target:
                if 'error' in d:raise RuntimeError(d['error'])
                return d['result']
            self.events.append(d)
    def init(self):self.req('initialize',{'clientInfo':{'name':'agent-state-native-probe','version':'1'},'capabilities':{'experimentalApi':True}})
    def close(self):self.p.terminate();self.p.wait(timeout=10)
    def until(self,predicate,seconds=40):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            d=self.read();self.events.append(d)
            if predicate(d):return d
        raise TimeoutError('native scenario deadline')
    def tool(self,thread,name,args):
        r=self.req('mcpServer/tool/call',{'threadId':thread,'server':'agent-state','tool':name,'arguments':args})
        if r.get('isError'):raise RuntimeError(r['content'])
        return r.get('structuredContent') or json.loads(r['content'][0]['text'])
    def turn(self,thread,prompt):
        self.req('turn/start',{'threadId':thread,'input':[{'type':'text','text':prompt}]})
        return self.until(lambda d:d.get('method')=='turn/completed' and d['params']['threadId']==thread)

def run(cmd):
    p=subprocess.run(cmd,env=env,text=True,capture_output=True,timeout=30)
    if p.returncode:raise RuntimeError(p.stderr[:2000])
    return p.stdout

server=ThreadingHTTPServer(('127.0.0.1',0),Provider);threading.Thread(target=server.serve_forever,daemon=True).start()
models=json.loads(pathlib.Path('/home/penis/.codex/models_cache.json').read_text())['models'];model=dict(next((m for m in models if m['slug']=='gpt-6.1-sol'), models[0])); model['slug']='gpt-6.1-sol'
(root/'models.json').write_text(json.dumps({'models':[model]}));(root/'compact.txt').write_text('NATIVE_GUIDE_COMPACT')
(root/'config.toml').write_text(f'''model = "gpt-6.1-sol"
model_provider = "fixture"
model_catalog_json = "{root}/models.json"
experimental_compact_prompt_file = "{root}/compact.txt"
model_auto_compact_token_limit = 5000
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture]
name = "fixture"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
[features]
hooks = true
plugins = true
apps = false
multi_agent = true
multi_agent_v2 = true
code_mode_host = true
token_budget = false
''')
c=None
try:
    run(['codex','plugin','marketplace','add',str(source.parents[1]),'--json'])
    install=json.loads(run(['codex','plugin','add','agent-state@personal','--json']))
    c=Client();c.init();handlers=c.req('hooks/list',{'cwds':[str(root)]})['data'][0]['hooks'];c.close()
    selected=[h for h in handlers if '/agent-state/' in h['sourcePath']]
    assert len(selected)==7,selected
    with (root/'config.toml').open('a') as f:
        for h in selected:f.write('\n[hooks.state.'+json.dumps(h['key'])+']\ntrusted_hash = '+json.dumps(h['currentHash'])+'\n')
    c=Client();c.init();root_thread=c.req('thread/start',{'cwd':str(root),'model':'gpt-6.1-sol','modelProvider':'fixture'})['thread']['id']
    inventory=c.req('mcpServerStatus/list',{'threadId':root_thread,'serverName':'agent-state','limit':100})
    c.turn(root_thread,'Bootstrap the native rollout before calling session-bound tools.')
    # This is a real MCP call through Codex, including its injected thread metadata.
    shared=c.tool(root_thread,'agent_state_note',{'title':'Shared procedure','body':SHARED+' When checking recovery, compare the original bytes.','shared':True})
    private=c.tool(root_thread,'agent_state_note',{'title':'Private procedure','body':PRIVATE+' Never share this guide with child sessions.'})
    c.tool(root_thread,'agent_state_checkpoint',{'content':ANCHOR+' When evaluating guides, verify applicability.'})
    original=pathlib.Path(shared['path']).read_bytes()
    c.turn(root_thread,'Establish a normal response before manual compact.')
    # Reproduce a legitimate bulk tool-output record in this disposable native
    # archive. The host still owns its in-memory conversation and compaction.
    rollout=next((root/'sessions').rglob('*'+root_thread+'.jsonl'))
    with rollout.open('a') as f:f.write(json.dumps({'type':'response_item','payload':{'type':'custom_tool_call_output','output':'x'*(3*1024*1024)}})+'\n')
    c.req('thread/compact/start',{'threadId':root_thread})
    oversized_compact=c.until(lambda d:d.get('method')=='turn/completed' and d['params']['threadId']==root_thread)
    c.turn(root_thread,'Use the saved future-action guides after manual compact.')
    manual=requests[-1]['shared'] and requests[-1]['parent_anchor'] and any(r['compact'] and r['phase']=='root' for r in requests)
    phase='auto';c.turn(root_thread,'Exercise automatic compact with a completed upstream usage sample.')
    auto=any(r['phase']=='auto' and r['compact'] for r in requests) and any(r['phase']=='auto' and r['step']>=2 and r['shared'] for r in requests if not r['compact'])
    phase='children';c.turn(root_thread,'Spawn one isolated guide fixture.')
    child_event=c.until(lambda d:d.get('method')=='item/completed' and d['params'].get('item',{}).get('type')=='agentMessage' and d['params']['item'].get('text') in ('CHILD_DONE','MISSING_GUIDES'))
    child=child_event['params']['threadId']
    child_requests=[r for r in requests if r['thread']==child and not r['compact']]
    child_complete=c.until(lambda d:d.get('method')=='turn/completed' and d['params']['threadId']==child)
    phase='followup';start=len(c.events);c.turn(root_thread,'Send a genuine v2 follow-up to the existing child.')
    def followup_message(d):return d.get('method')=='item/completed' and d['params'].get('threadId')==child and d['params'].get('item',{}).get('type')=='agentMessage'
    followup_event=next((d for d in c.events[start:] if followup_message(d)),None) or c.until(followup_message)
    followup=followup_event['params']['item']['text']=='CHILD_FOLLOWUP_GUIDED'
    # Exercise the production PreCompact guard with a corrupt durable anchor,
    # then restore the same original bytes and retry. No reset/provider compact
    # request may occur while the guard cannot verify its recovery source.
    cpfile=root/'guide-state'/'sessions'/hashlib.sha256(root_thread.encode()).hexdigest()/'checkpoint.json'
    beforecp=cpfile.read_bytes();cpfile.write_text('{corrupt fixture')
    phase='io_failure';before_requests=len(requests)
    c.req('thread/compact/start',{'threadId':root_thread})
    stopped=c.until(lambda d:d.get('method')=='turn/completed' and d['params']['threadId']==root_thread)
    guard_stopped=stopped['params']['turn']['status']=='interrupted' and not any(r['compact'] for r in requests[before_requests:])
    cpfile.write_bytes(beforecp);phase='io_repaired';c.req('thread/compact/start',{'threadId':root_thread})
    repaired=c.until(lambda d:d.get('method')=='turn/completed' and d['params']['threadId']==root_thread)
    guard_repaired=repaired['params']['turn']['status']=='completed' and any(r['compact'] and r['phase']=='io_repaired' for r in requests)
    old_events=c.events;c.close();phase='resume';c=Client();c.init()
    c.req('thread/resume',{'threadId':root_thread,'cwd':str(root),'model':'gpt-6.1-sol','modelProvider':'fixture'})
    c.turn(root_thread,'Apply saved reusable guides after a fresh-process resume.')
    resumed=requests[-1]['shared'] and requests[-1]['private'] and requests[-1]['parent_anchor']
    c.events=old_events+c.events
    phase='unrelated';unrelated=c.req('thread/start',{'cwd':str(root),'model':'gpt-6.1-sol','modelProvider':'fixture'})['thread']['id']
    c.turn(unrelated,'Independent thread isolation probe.')
    isolated=not any(requests[-1][k] for k in ('shared','private','parent_anchor','child','full_child_anchor'))
    report=c.tool(root_thread,'agent_state_read',{});search=c.tool(root_thread,'agent_state_history',{'query':'Establish a normal response'})
    full=c.tool(root_thread,'agent_state_read',{'note_id':shared['note_id']})
    errors=[e['params']['run'] for e in c.events if e.get('method')=='hook/completed' and '/agent-state/' in e['params']['run'].get('sourcePath','') and e['params']['run']['status']=='failed']
    result={'scratch':str(root),'installed_path':install['installedPath'],'mode':mode,'native_hooks':len(selected),'requests':requests,'root_manual_recovered':manual,'oversized_record_compact_completed':oversized_compact['params']['turn']['status']=='completed' and report['usage']['rollout_coverage']['skipped_records']>=1,'root_auto_recovered':auto,'root_fresh_resume_recovered':resumed,'child_initial_shared_only':bool(child_requests and child_requests[0]['shared'] and not child_requests[0]['private'] and not child_requests[0]['parent_anchor']),'child_original_guides_recovered':any(r['child'] and r['full_child_anchor'] for r in child_requests if r['step']>=5),'child_after_recovery_action':(root/'restored-action').exists(),'child_final':child_event['params']['item']['text'],'child_v2_followup':followup,'unrelated_isolated':isolated,'corrupt_checkpoint_stops_reset':guard_stopped,'storage_repair_allows_retry':guard_repaired,'ledger_unchanged':pathlib.Path(shared['path']).read_bytes()==original,'history_before_compact_found':bool(search['matches']),'original_read':SHARED in full['content'],'exact_sample':report['usage']['latest'],'uncalibrated':report['usage']['native_cutoff'] is None,'failed_hooks':errors,'tool_count':len(inventory.get('data',[{}])[0].get('tools',{}))}
    (root/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    checks=['root_manual_recovered','oversized_record_compact_completed','root_auto_recovered','root_fresh_resume_recovered','child_initial_shared_only','child_original_guides_recovered','child_after_recovery_action','child_v2_followup','unrelated_isolated','corrupt_checkpoint_stops_reset','storage_repair_allows_retry','ledger_unchanged','history_before_compact_found','original_read','uncalibrated']
    assert all(result[k] for k in checks) and result['child_final']=='CHILD_DONE' and not errors,result
    print(json.dumps({k:v for k,v in result.items() if k!='requests'},ensure_ascii=False))
finally:
    if c and c.p.poll() is None:c.close()
    server.shutdown()
