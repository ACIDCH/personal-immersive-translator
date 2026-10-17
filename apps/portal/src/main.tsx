import React from 'react';
import {createRoot} from 'react-dom/client';
import {Shell} from '../../shared-ui/Shell';
import '../../shared-ui/design.css';
import {DocumentLab} from '../../shared-ui/DocumentLab';
import '../../shared-ui/document-lab.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><><Shell view="dashboard"/><DocumentLab/></></React.StrictMode>);
