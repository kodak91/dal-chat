import React from 'react'
import ReactDOM from 'react-dom/client'
import emailjs from '@emailjs/browser'
import DalChat from './DalChat.jsx'

emailjs.init("CzDpYaGEzYS0WVSfo")

ReactDOM.createRoot(document.getElementById('root')).render(<DalChat />)
