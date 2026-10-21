import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfTextLines} from '../src/lib/pdf-text-layout.js';

test('PDF.js positioned fragments reconstruct one natural reading line',()=>{
 const out=pdfTextLines({items:[
  {str:'What',transform:[1,0,0,1,10,300],width:28,height:12},
  {str:'you',transform:[1,0,0,1,43,300],width:20,height:12},
  {str:'choose',transform:[1,0,0,1,67,300],width:40,height:12,hasEOL:true},
  {str:'Search Jobs',transform:[1,0,0,1,10,276],width:75,height:12,hasEOL:true}
 ]});
 assert.deepEqual(out,['What you choose','Search Jobs']);
});
test('PDF text flow preserves CJK adjacency and standalone math tokens',()=>{
 assert.deepEqual(pdfTextLines({items:[
  {str:'今',transform:[1,0,0,1,1,100],width:11,height:10},
  {str:'天',transform:[1,0,0,1,12,100],width:11,height:10,hasEOL:true},
  {str:'E',transform:[1,0,0,1,1,80],width:6,height:10},
  {str:'=',transform:[1,0,0,1,9,80],width:6,height:10},
  {str:'mc²',transform:[1,0,0,1,17,80],width:20,height:10,hasEOL:true}
 ]}),['今天','E = mc²']);
});
test('PDF rows with no geometry never drop any actual source text',()=>{
 assert.deepEqual(pdfTextLines({items:[
  {str:'Hello'},{str:'World',hasEOL:true},{str:'Second',hasEOL:true}
 ]}),['Hello World','Second']);
 assert.deepEqual(pdfTextLines({items:[]}),[]);
});
