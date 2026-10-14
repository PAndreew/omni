import { useEffect, useState } from 'react';
import DocumentTranslator from './DocumentTranslator.jsx';
import FileUpload from './FileUpload.jsx';
import SpotifyBrowser from './SpotifyBrowser.jsx';
import MusicAliases from './MusicAliases.jsx';
import { FileText, Upload } from 'lucide-react';
import PiIcon from './icons/PiIcon.jsx';
import { Button } from './ui/button.jsx';
import { Card } from './ui/card.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx';

const piWebUrl = import.meta.env.VITE_PI_WEB_URL || 'https://raspberrypi.tailf0acdd.ts.net:10000';
function SpotifyIcon() {
  return <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" /><g fill="none" stroke="#1ed760" strokeLinecap="round"><path d="M5.5 9c4.5-1.4 8.2-.9 13 1.1" strokeWidth="2" /><path d="M6.5 12.5c3.7-1.1 7.1-.7 10.7.9" strokeWidth="1.7" /><path d="M7.4 16c3-.8 5.6-.5 8.7.8" strokeWidth="1.5" /></g></svg>;
}

export default function ControlPanel() {
  const [modal, setModal] = useState(null);
  useEffect(() => {
    const dismiss = () => setModal(null);
    window.addEventListener('gizi:wake', dismiss);
    return () => window.removeEventListener('gizi:wake', dismiss);
  }, []);
  return <Card className="tile control-panel">
    <h2 className="title">Apps</h2>
    <div className="app-grid" aria-label="Apps">
      <Button variant="ghost" className="app-shortcut" onClick={() => setModal(['spotify', 'Spotify'])}><span className="app-icon app-icon-spotify"><SpotifyIcon /></span><span>Spotify</span></Button>
      <Button variant="ghost" className="app-shortcut" aria-label="DOCX / PDF translator" onClick={() => setModal(['document-translator', 'DOCX / PDF translator'])}><span className="app-icon app-icon-docs"><FileText size={34} aria-hidden="true" /></span><span>Translate</span></Button>
      <Button variant="ghost" className="app-shortcut" onClick={() => setModal(['file-upload', 'Upload files to Pi'])}><span className="app-icon app-icon-docs"><Upload size={34} aria-hidden="true" /></span><span>Upload</span></Button>
      <Button asChild variant="ghost" className="app-shortcut"><a href={piWebUrl} target="_blank" rel="noopener noreferrer"><span className="app-icon app-icon-pi"><PiIcon size={36} /></span><span>Pi Web</span></a></Button>
    </div>
    <Dialog open={!!modal} onOpenChange={open => { if (!open) setModal(null); }}>
      {modal && <DialogContent className="applet-dialog" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{modal[1]}</DialogTitle></DialogHeader>
        {modal[0] === 'spotify' ? <div className="spotify-modal"><SpotifyBrowser /><Button variant="outline" onClick={() => setModal(['metadata', 'Spotify metadata'])}>Metadata / aliases</Button></div> : modal[0] === 'metadata' ? <MusicAliases /> : modal[0] === 'document-translator' ? <DocumentTranslator /> : modal[0] === 'file-upload' ? <FileUpload /> : null}
      </DialogContent>}
    </Dialog>
  </Card>;
}
