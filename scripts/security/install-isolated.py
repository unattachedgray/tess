#!/usr/bin/env python3
"""Root installer: validate isolated alternate port before stopping only Tess."""
import os, pathlib, subprocess, pwd, shutil, sqlite3, time, urllib.request, json, socket
assert os.geteuid() == 0, 'root required'
P=pathlib.Path
stage=P('/home/julian/.local/state/security-audit-20260927/tess/release')
release=P('/opt/weft-tess')
config=P('/etc/weft-tess')
state=P('/var/lib/weft-tess')
units=P('/etc/systemd/system')
owner='julian'
pm2='/home/julian/.nvm/versions/node/v22.23.2/bin/pm2'
node='/home/julian/.nvm/versions/node/v22.23.2/bin'
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
def owner_run(*args):return run('runuser','-u',owner,'--','env','-i','HOME=/home/julian','PM2_HOME=/home/julian/.pm2',f'PATH={node}:/usr/bin:/bin',*args,stdout=subprocess.DEVNULL)
def health(port):
 with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=2) as r:return json.load(r)
def ready(port):
 for _ in range(60):
  try:
   h=health(port)
   if h['status']=='ok' and h['discovery'] is False:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('isolated service did not become healthy')
def backup(source,dest):
 with sqlite3.connect(f'file:{source}?mode=ro',uri=True) as src,sqlite3.connect(dest) as dst:src.backup(dst)
assert not release.exists(), 'Refuse overwriting an existing release; use documented update procedure'
assert health(8460)['activeGames']==0, 'Active games: refuse cutover'
assert (P('/etc/weft-blog-public/cascade-key')).is_file(), 'Economy credential unavailable'
try:account=pwd.getpwnam('weft-tess')
except KeyError:
 run('useradd','--system','--home-dir',str(state),'--shell','/usr/sbin/nologin','--user-group','weft-tess');account=pwd.getpwnam('weft-tess')
shutil.copytree(stage,release,symlinks=True)
for root,dirs,files in os.walk(release):
 os.chown(root,0,0);os.chmod(root,0o755)
 for name in dirs + files:
  f=P(root)/name
  if f.is_symlink():
   assert f.resolve().is_relative_to(release), f'Escaping release symlink: {f}'
   os.lchown(f,0,0)
  else:os.chown(f,0,0);os.chmod(f,0o755 if os.access(f,os.X_OK) else 0o644)
config.mkdir(mode=0o700);state.mkdir(mode=0o700)
os.chown(state,account.pw_uid,account.pw_gid)
shutil.copyfile('/etc/weft-blog-public/cascade-key',config/'cascade-key');os.chmod(config/'cascade-key',0o600)
(config/'egress.nft').write_text(f'''table inet weft_tess {{
 chain output {{
  type filter hook output priority -5; policy accept;
  meta skuid {account.pw_uid} ct state established,related accept
  meta skuid {account.pw_uid} ip daddr 127.0.0.1 tcp dport 8090 accept
  meta skuid {account.pw_uid} reject
 }}
}}
''')
for unit in ['weft-tess.service','weft-tess-egress.service']:
 shutil.copyfile(release/'scripts/security'/unit,units/unit)
run('systemd-analyze','verify',str(units/'weft-tess.service'),str(units/'weft-tess-egress.service'))
run('/usr/sbin/nft','--check','-f',str(config/'egress.nft'))
override=units/'weft-tess.service.d';override.mkdir();(override/'preflight.conf').write_text('[Service]\nEnvironment=PORT=18460\nEnvironment=TESS_DB_PATH=/var/lib/weft-tess/preflight.db\nEnvironment=TESS_AI_GLOBAL_DAY=0\n')
run('systemctl','daemon-reload');run('systemctl','start','weft-tess.service')
old_stopped=False
try:
 ready(18460)
 run(str(release/'runtime/node'),str(release/'scripts/security/smoke.mjs'),'http://127.0.0.1:18460')
 # Liveness controls make denied file/socket results meaningful.
 with socket.create_connection(('127.0.0.1',22),2):pass
 assert P('/home/julian/.env').is_file()
 # A separate process with the same UID proves DAC and nft boundaries.
 run('runuser','-u','weft-tess','--','python3',str(release/'scripts/security/boundary.py'))
 assert health(8460)['activeGames']==0, 'Games started during preflight: refuse cutover'
 run('systemctl','stop','weft-tess.service')
 owner_run(pm2,'stop','tess');old_stopped=True
 backup('/home/julian/dev/tess/data/tess.db',config/'original-tess.db')
 backup(config/'original-tess.db',state/'tess.db');os.chown(state/'tess.db',account.pw_uid,account.pw_gid);os.chmod(state/'tess.db',0o600)
 (override/'preflight.conf').unlink();override.rmdir();run('systemctl','daemon-reload')
 run('systemctl','enable','weft-tess-egress.service','weft-tess.service');run('systemctl','start','weft-tess.service');ready(8460)
 run(str(release/'runtime/node'),str(release/'scripts/security/smoke.mjs'),'http://127.0.0.1:8460')
 owner_run(pm2,'save')
 print('RESULT: Tess isolated; all three live engines verified; old PM2 Tess stopped and saved')
except BaseException:
 run('systemctl','stop','weft-tess.service')
 if old_stopped:owner_run(pm2,'save')
 print('RESULT: cutover aborted; owner-UID service was not restarted')
 raise
