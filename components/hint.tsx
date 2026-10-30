import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Podpowiedz przy etykiecie. Celowo NIE owijamy samych kontrolek: przelacznik
// albo przycisk owiniety w drugi element interaktywny potrafi zgubic zdarzenia
// i miesza kolejnosc czytania dla czytnikow ekranu. Osobna ikona kosztuje kilka
// pikseli, ale jest widoczna obietnica, ze jest tu cos do przeczytania -
// podpowiedz, o ktorej nikt nie wie, nie istnieje.
//
// Trescia jest to, czego z samego interfejsu nie widac: co dana rzecz robi POZA
// ekranem i czego NIE robi. Opisywanie etykiety jej wlasnymi slowami byloby
// szumem, ktory uczy ludzi ignorowac wszystkie dymki.
export function Hint({ text, side = 'top', ciemna = false }: { text: string; side?: 'top' | 'bottom' | 'left' | 'right'; ciemna?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label="More information"
        className={cn(
          'inline-grid size-4 shrink-0 place-items-center rounded-full align-middle transition',
          ciemna ? 'text-white/45 hover:text-white/80' : 'text-[#9aa5a2] hover:text-[#4b6b64]',
        )}
        type="button"
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-5" side={side}>{text}</TooltipContent>
    </Tooltip>
  );
}
