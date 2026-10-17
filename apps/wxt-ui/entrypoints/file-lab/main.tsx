import React from 'react';
import {createRoot} from 'react-dom/client';
import {DocumentLab} from '../../../shared-ui/DocumentLab';
import {BatchFileLab} from '../../../shared-ui/BatchFileLab';
import {SubtitleFileLab} from '../../../shared-ui/SubtitleFileLab';
import {PdfBilingualLab} from '../../../shared-ui/PdfBilingualLab';
import '../../../shared-ui/design.css';
import '../../../shared-ui/document-lab.css';

// An extension-owned page: user-selected files stay in browser memory;
// no remote translation request or account login is implied.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><DocumentLab/><BatchFileLab/><SubtitleFileLab/><PdfBilingualLab/></React.StrictMode>
);
