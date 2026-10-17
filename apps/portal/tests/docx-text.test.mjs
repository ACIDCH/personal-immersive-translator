import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import mammoth from 'mammoth';

// Construct a tiny, real OOXML DOCX, not a mocked Mammoth response.
test('Mammoth reads actual in-memory DOCX text without cloud upload',async()=>{
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
   '<Default Extension="xml" ContentType="application/xml"/>'+
   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?>'+
   '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
   '<w:body><w:p><w:r><w:t>Financial analysis test paragraph</w:t></w:r></w:p>'+
   '<w:p><w:r><w:t>Second section with translated text pending</w:t></w:r></w:p></w:body></w:document>');
 const buffer=await zip.generateAsync({type:'nodebuffer'});
 const result=await mammoth.extractRawText({buffer});
 assert.match(result.value,/Financial analysis test paragraph/);
 assert.match(result.value,/Second section with translated text pending/);
 assert.equal(result.messages.filter(x=>x.type==='error').length,0);
 console.log('DOCX original text extraction PASS; no translation performed');
});
