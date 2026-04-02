import React from 'react'
import ReactDOM from 'react-dom/client'
import DalChat from './DalChat.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

ReactDOM.createRoot(document.getElementById('root')).render(<DalChat />)
