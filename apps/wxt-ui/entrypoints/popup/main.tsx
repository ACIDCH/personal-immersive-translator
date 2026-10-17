import React from 'react';
import {createRoot} from 'react-dom/client';
import {Shell} from '../../shared/Shell';
import '../../shared/design.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Shell view="popup"/></React.StrictMode>);
