import React from 'react'
import ReactDOM from 'react-dom/client'
import emailjs from '@emailjs/browser'
import ReactGA from 'react-ga4'
import App from './App.jsx'

emailjs.init({ publicKey: "CzDpYaGEzYS0WVSfo" })

ReactGA.initialize('G-73QMC4SSQW')
ReactGA.send({ hitType: 'pageview', page: '/' })

window.addEventListener('appinstalled', () => {
  ReactGA.event({ category: 'PWA', action: 'installed' })
})

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
