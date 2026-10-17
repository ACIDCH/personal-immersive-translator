import React from 'react';
import {createRoot} from 'react-dom/client';
import {Shell} from '../../../shared-ui/Shell';
import {NativeWebControls} from './NativeWebControls';
import '../../../shared-ui/design.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Shell view="popup" webControls={<NativeWebControls/>}/></React.StrictMode>);
