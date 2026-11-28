"""Read cached numeric/string cells in an Office Open XML sheet without Excel dependencies."""
from xml.etree import ElementTree as ET
import zipfile,io,posixpath,re
def rows(body,name):
 with zipfile.ZipFile(io.BytesIO(body)) as z:
  shared=[''.join(x.itertext()).strip() for x in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
  wb=ET.fromstring(z.read('xl/workbook.xml'));rel=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
  sheet=next(x for x in wb.findall('.//{*}sheet') if x.get('name')==name)
  target=next(x.get('Target') for x in rel if x.get('Id')==sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'))
  path=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
  rr=[]
  for r in ET.fromstring(z.read(path)).findall('.//{*}row'):
   line={}
   for c in r.findall('{*}c'):
    value=c.findtext('{*}v');col=re.match('[A-Z]+',c.get('r')).group()
    if c.get('t')=='inlineStr':value=''.join(c.find('{*}is').itertext())
    if value is None:continue
    line[col]=shared[int(value)] if c.get('t')=='s' else value
   if line:rr.append(line)
  return rr
