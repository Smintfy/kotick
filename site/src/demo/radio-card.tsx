import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { RadioGroupItem } from '@/components/ui/radio-group';

type RadioCardProps = { value: string; icon: LucideIcon; disabled?: boolean; children: ReactNode };

export function RadioCard({ value, icon: Icon, disabled, children }: RadioCardProps) {
  return (
    <Label className="relative h-9 cursor-pointer gap-2.5 rounded-lg px-2.5 leading-normal shadow-code transition-[background-color,box-shadow] hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-data-checked:shadow-[0_0_0_1px_var(--foreground),0_1px_2px_oklch(0_0_0/0.05)] has-data-checked:text-foreground has-data-disabled:pointer-events-none has-data-disabled:opacity-50">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {children}
      <RadioGroupItem value={value} disabled={disabled} className="absolute opacity-0" />
    </Label>
  );
}
