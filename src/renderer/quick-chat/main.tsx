import React from 'react'
import ReactDOM from 'react-dom/client'
import { QuickChat } from './QuickChat'
import './quick-chat.css'

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <QuickChat />
  </React.StrictMode>
)
