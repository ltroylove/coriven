import SysTray from 'systray2'
import * as path from 'path'
import * as fs from 'fs'
import { exec } from 'child_process'
import { CONFIG } from './config'

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.ico')

function loadIconBase64(): string {
  try {
    return fs.readFileSync(ICON_PATH).toString('base64')
  } catch {
    // Minimal 1x1 ICO as fallback
    return 'AAABAAEAAQEAAAEAGAAAACYAAABBAAACACAAAAA='
  }
}

export function createTray(onQuit: () => void): SysTray {
  const tray = new SysTray({
    menu: {
      icon: loadIconBase64(),
      title: '',
      tooltip: 'Personal Assistant',
      items: [
        {
          title: 'Open App',
          tooltip: 'Open the Personal Assistant web app',
          checked: false,
          enabled: true,
        },
        SysTray.separator,
        {
          title: 'Quit',
          tooltip: 'Exit Personal Assistant tray',
          checked: false,
          enabled: true,
        },
      ],
    },
    debug: false,
    copyDir: true,
  })

  tray.onClick(action => {
    if (action.seq_id === 0) {
      // Open App
      const url = CONFIG.appUrl
      exec(`start "" "${url}"`, err => {
        if (err) console.error('Failed to open app:', err)
      })
    } else if (action.seq_id === 2) {
      // Quit
      tray.kill(false)
      onQuit()
    }
  })

  return tray
}
