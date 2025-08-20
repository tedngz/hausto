
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCurrency } from '@/contexts/CurrencyContext';

interface BudgetRangeSelectorProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

export const BudgetRangeSelector = ({ value, onChange }: BudgetRangeSelectorProps) => {
  const { formatPrice, currency, setCurrency } = useCurrency();
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const PRESET_RANGES = [
    { label: 'Budget', range: [3000000, 8000000] as [number, number], description: 'Affordable options' },
    { label: 'Mid-range', range: [8000000, 20000000] as [number, number], description: 'Best value for money' },
    { label: 'Premium', range: [20000000, 40000000] as [number, number], description: 'High-end properties' },
  ];

  const handlePresetClick = (preset: typeof PRESET_RANGES[0]) => {
    onChange(preset.range);
    setActivePreset(preset.label);
  };

  const handleSliderChange = (newValue: number[]) => {
    onChange(newValue as [number, number]);
    setActivePreset(null);
  };

  // Find active preset based on current value
  const currentPreset = PRESET_RANGES.find(preset => 
    preset.range[0] === value[0] && preset.range[1] === value[1]
  );

  return (
    <div className="space-y-6 max-w-md mx-auto">
      {/* Currency Switch */}
      <div className="flex items-center justify-center space-x-3">
        <span className={`text-sm font-medium ${currency === 'VND' ? 'text-primary' : 'text-muted-foreground'}`}>
          ₫ VND
        </span>
        <Switch
          checked={currency === 'USD'}
          onCheckedChange={(checked) => setCurrency(checked ? 'USD' : 'VND')}
          className="data-[state=checked]:bg-primary"
        />
        <span className={`text-sm font-medium ${currency === 'USD' ? 'text-primary' : 'text-muted-foreground'}`}>
          $ USD
        </span>
      </div>

      {/* Quick Presets */}
      <div className="space-y-4">
        <Label className="text-base font-medium text-slate-900 block text-center">Budget Range</Label>
        <div className="space-y-3">
          {PRESET_RANGES.map((preset) => (
            <Button
              key={preset.label}
              variant={activePreset === preset.label || currentPreset?.label === preset.label ? 'default' : 'outline'}
              size="lg"
              onClick={() => handlePresetClick(preset)}
              className={`w-full h-auto py-4 transition-all duration-200 ${
                activePreset === preset.label || currentPreset?.label === preset.label
                  ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg border-none'
                  : 'hover:bg-orange-50 hover:border-orange-300 hover:shadow-md'
              }`}
            >
              <div className="text-center w-full">
                <div className="font-semibold text-lg">{preset.label}</div>
                <div className="text-sm opacity-90 mt-1">{preset.description}</div>
                <div className="text-xs opacity-75 mt-1">
                  {formatPrice(preset.range[0])} - {formatPrice(preset.range[1])}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </div>

      {/* Custom Slider */}
      <div className="space-y-4">
        <Label className="text-base font-medium text-slate-900 block text-center">Custom Range</Label>
        <div className="px-2">
          <Slider
            value={value}
            onValueChange={handleSliderChange}
            max={40000000}
            min={3000000}
            step={500000}
            className="w-full"
          />
          
          <div className="flex justify-between text-sm text-slate-600 mt-3 font-medium">
            <div className="text-center">
              <div className="font-semibold text-orange-600">{formatPrice(value[0])}</div>
              <div className="text-xs opacity-75">Min</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-orange-600">{formatPrice(value[1])}</div>
              <div className="text-xs opacity-75">Max</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
