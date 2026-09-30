import ast,hashlib,json,os,pathlib,selectors,subprocess,tempfile,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
source=pathlib.Path(__file__).resolve().parents[1]
root=pathlib.Path(tempfile.mkdtemp(prefix='agent-state-imperative-',dir='/home/penis/tmp'))
env={**os.environ,'CODEX_HOME':str(root),'CODEX_AGENT_STATE_STATE_DIR':str(root/'guides'),'CODEX_CONTROL_TASK_STATE_DIR':str(root/'control')}
syntax=ast.parse((source/'tests/native-host.py').read_text())
helpers=ast.Module(body=[x for x in syntax.body if isinstance(x,(ast.ClassDef,ast.FunctionDef)) and x.name in ['Client','strings','msg','code','run']],type_ignores=[])
exec(compile(helpers,'native-helpers','exec'))
phase='bootstrap';requests=[];count=0;GUIDE='SAVED_NATIVE_REUSABLE_GUIDE_72b3'
class Provider(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  global count
  b=json.loads(self.rfile.read(int(self.headers['Content-Length'])));text='\n'.join(strings(b.get('input')));compact='NATIVE_IMPERATIVE_COMPACT' in text
  count+=1;n=count;save='YOU MUST SAVE IMPORTANT REUSABLE GUIDES NOW' in text;decompose="DECOMPOSE THE USER'S REQUEST AND UPDATE CONTROL STATE" in text
  requests.append({'phase':phase,'compact':compact,'save':save,'decompose':decompose,'guide':GUIDE in text,'n':n})
  tokens=100
  if compact:items=[msg('Summary omits original guide.',n)]
  elif phase=='near' and n==2:items=[code('true',n)];tokens=4100
  elif phase=='near' and n==3 and save:
   items=[{'id':'ct_'+str(n),'type':'custom_tool_call','call_id':'call_'+str(n),'name':'exec','input':'text(await tools.mcp__agent_state__agent_state_note('+json.dumps({'title':'Native procedure','body':GUIDE+' When a CLI parses decimal numbers, fix the helper locale.'})+'));'}];tokens=4100
  elif phase=='near' and n==4 and save:items=[code('touch '+str(root/'continued-task'),n)];tokens=4100
  else:items=[msg('DONE',n)]
  rid='resp_'+str(n);events=[('response.created',{'response':{'id':rid,'status':'in_progress'}})]
  for j,it in enumerate(items):events.extend([('response.output_item.added',{'output_index':j,'item':it}),('response.output_item.done',{'output_index':j,'item':it})])
  events.append(('response.completed',{'response':{'id':rid,'status':'completed','output':items,'usage':{'input_tokens':tokens,'output_tokens':10,'total_tokens':tokens+10}}}))
  data=''.join('event: '+k+'\ndata: '+json.dumps({'type':k,**v})+'\n\n' for k,v in events).encode()
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
s=ThreadingHTTPServer(('127.0.0.1',0),Provider);threading.Thread(target=s.serve_forever,daemon=True).start()
models=json.loads(pathlib.Path('/home/penis/.codex/models_cache.json').read_text())['models'];model=dict(next((m for m in models if m['slug']=='gpt-6.1-sol'),models[0]))
model['slug']='gpt-6.1-sol'
(root/'models.json').write_text(json.dumps({'models':[model]}));(root/'compact.txt').write_text('NATIVE_IMPERATIVE_COMPACT')
(root/'config.toml').write_text(f"""model="gpt-6.1-sol"
model_provider="fixture"
model_catalog_json="{root}/models.json"
experimental_compact_prompt_file="{root}/compact.txt"
model_auto_compact_token_limit=5000
approval_policy="never"
sandbox_mode="danger-full-access"
[model_providers.fixture]
name="fixture"
base_url="http://127.0.0.1:{s.server_port}/v1"
wire_api="responses"
requires_openai_auth=false
[features]
hooks=true
plugins=true
apps=false
code_mode_host=true
token_budget=false
""")
c=None
try:
 run(['codex','plugin','marketplace','add',str(source.parents[1]),'--json'])
 for name in ['agent-state','control-task']:run(['codex','plugin','add',name+'@personal','--json'])
 c=Client();c.init();hooks=c.req('hooks/list',{'cwds':[str(root)]})['data'][0]['hooks'];c.close()
 with (root/'config.toml').open('a') as f:
  for h in hooks:f.write('\n[hooks.state.'+json.dumps(h['key'])+']\ntrusted_hash='+json.dumps(h['currentHash'])+'\n')
 c=Client();c.init();sid=c.req('thread/start',{'cwd':str(root),'model':'gpt-6.1-sol','modelProvider':'fixture'})['thread']['id']
 c.turn(sid,'Bootstrap.');phase='near';c.turn(sid,'Work until the save reminder; save one reusable procedure and continue the same task.')
 near=[r for r in requests if r['phase']=='near'];written=c.tool(sid,'agent_state_read',{});continued=(root/'continued-task').is_file()
 early=any(r['save'] and not r['compact'] for r in near) and not any(r['compact'] for r in near)
 decompose=all(r['decompose'] for r in near)
 phase='compact';c.req('thread/compact/start',{'threadId':sid});c.until(lambda d:d.get('method')=='turn/completed' and d['params']['threadId']==sid)
 phase='restored';c.turn(sid,'Continue with the original saved guide.')
 result={'scratch':str(root),'early_save_reminder':early,'continued_after_save':continued,'control_prompt_reminder':decompose,'saved_notes':written['total_notes'],'original_guide_restored':requests[-1]['guide'],'requests':requests}
 (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
 assert early and continued and decompose and written['total_notes']==1 and requests[-1]['guide'],result
finally:
 if c and c.p.poll() is None:c.close()
 s.shutdown()
