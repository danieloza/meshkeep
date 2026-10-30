import { Cloud } from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Hint } from '@/components/hint';
import { cn } from '@/lib/utils';

// The member's switch for the file agent. The server enforces it, so turning
// it off stops any agent, including a modified one.
export function FolderSyncCard({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <Card className="border-0 bg-surface-raised/90 shadow-none ring-line">
    <CardHeader>
      <CardDescription className="flex items-center gap-2"><Cloud className="size-4" /> File agent</CardDescription>
      <CardTitle className="flex items-center gap-1.5 text-base">Folder sync<Hint side="bottom" text="Enforced by the server, not by the script. While this is off the server rejects uploads and deletions from any agent, including a modified one. Browser uploads are unaffected." /></CardTitle>
      <CardAction><Switch aria-label="Local folder sync" checked={enabled} onCheckedChange={onChange} /></CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-sm leading-6 text-ink-muted">{enabled ? 'The agent running on your computer can upload changed files to a selected project and, with -PropagateDeletes, remove files deleted from disk.' : 'The server rejects agent uploads and deletions. Browser uploads work independently of this switch.'}</p>
      <p className="mt-3 text-xs leading-5 text-ink-subtle">This covers local files only. Codex, Claude, Gemini and Grok conversations require a manual JSON import.</p>
      <div className="mt-4 flex items-center gap-2 text-xs text-ink-muted"><span aria-hidden className={cn('size-2 rounded-full', enabled ? 'bg-ok-text' : 'bg-ink-subtle')} />{enabled ? 'Active · files only' : 'Manually disabled'}</div>
    </CardContent>
  </Card>;
}
