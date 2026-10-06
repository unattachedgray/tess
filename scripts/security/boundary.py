import socket,os,pathlib
assert os.geteuid() != 0
for name in ['/home/julian/.env','/home/julian/.config/weft/credentials','/etc/weft-tess/cascade-key']:
 try:
  with open(name,'rb') as f:f.read(1)
 except (PermissionError,FileNotFoundError,IsADirectoryError):pass
 else:raise RuntimeError('Sensitive file readable')
for host,port in [('127.0.0.1',8090),('127.0.0.1',22),('1.1.1.1',443)]:
 s=socket.socket();s.settimeout(2)
 try:s.connect((host,port));connected=True
 except OSError:connected=False
 finally:s.close()
 assert connected == (port==8090), 'Network boundary mismatch'
print('Dedicated UID file and egress boundaries passed; gateway positive control connected')
