import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon, X, Gift, CalendarCheck } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { VIEWINGS_PER_PACK, INCLUDED_VIEWINGS_PER_CYCLE, useViewingQuota } from '@/hooks/useViewingQuota';

interface Property {
  id: string;
  title: string;
  images?: string[];
  location?: string;
  price?: number;
}

// Half-hour slots from 8am to 8pm - the window realtors and owners actually
// take visits in. Renters pick a range instead of typing free text.
const TIME_OPTIONS = Array.from({ length: 25 }, (_, i) => {
  const minutes = 8 * 60 + i * 30;
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const label = `${hour12}:${minutes % 60 === 0 ? '00' : '30'} ${hour24 < 12 ? 'AM' : 'PM'}`;
  return { value: String(minutes), label };
});

interface TimeRange {
  start: string;
  end: string;
}

const formatRange = (range: TimeRange) => {
  const start = TIME_OPTIONS.find(o => o.value === range.start);
  const end = TIME_OPTIONS.find(o => o.value === range.end);
  return start && end ? `${start.label} - ${end.label}` : '';
};

interface ViewingScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (scheduleData: ViewingScheduleData) => void;
  matchedProperties: Property[];
  onPropertyClick?: (propertyId: string) => void;
  initialSelectedIds?: string[];
}

export interface ViewingScheduleData {
  dates: Date[];
  preferredTimes: string[];
  specialRequirements: string;
  selectedPropertyIds: string[];
}

export const ViewingScheduleModal = ({ isOpen, onClose, onSubmit, matchedProperties, onPropertyClick, initialSelectedIds }: ViewingScheduleModalProps) => {
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [timeRanges, setTimeRanges] = useState<TimeRange[]>([{ start: '', end: '' }]);
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>(initialSelectedIds?.[0] ?? '');
  const { toast } = useToast();
  const { quota, purchaseViewingPack } = useViewingQuota();
  const quotaExhausted = !!quota && !quota.canBook;

  // Re-seed selection whenever modal opens or initial ids change
  useEffect(() => {
    if (isOpen) {
      setSelectedPropertyId(initialSelectedIds?.[0] ?? '');
    }
  }, [isOpen, initialSelectedIds?.join(',')]);

  const handleAddDate = (date: Date | undefined) => {
    if (!date) return;
    
    // Check if date is already selected
    const isAlreadySelected = selectedDates.some(
      d => format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );
    
    if (isAlreadySelected) {
      // Remove date if already selected
      setSelectedDates(selectedDates.filter(
        d => format(d, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd')
      ));
    } else {
      // Add date
      setSelectedDates([...selectedDates, date]);
    }
  };

  const handleRemoveDate = (dateToRemove: Date) => {
    setSelectedDates(selectedDates.filter(
      d => format(d, 'yyyy-MM-dd') !== format(dateToRemove, 'yyyy-MM-dd')
    ));
  };

  const handleAddTimeSlot = () => {
    setTimeRanges([...timeRanges, { start: '', end: '' }]);
  };

  const handleRemoveTimeSlot = (index: number) => {
    setTimeRanges(timeRanges.filter((_, i) => i !== index));
  };

  const handleTimeChange = (index: number, field: keyof TimeRange, value: string) => {
    setTimeRanges(timeRanges.map((range, i) => {
      if (i !== index) return range;
      const next = { ...range, [field]: value };
      // An end at or before the start is not a range - clear the other half.
      if (next.start && next.end && Number(next.end) <= Number(next.start)) {
        return field === 'start' ? { ...next, end: '' } : { ...next, start: '' };
      }
      return next;
    }));
  };

  const handleSubmit = () => {
    // Validation
    if (quotaExhausted) {
      toast({
        title: "Viewing limit reached",
        description: quota?.trialUsed
          ? "You've used your free viewing coordination. Go Premium or get the viewing pack to keep booking."
          : `You've used all ${quota?.included ?? INCLUDED_VIEWINGS_PER_CYCLE} of your viewing coordination. Get the viewing pack to keep booking.`,
        variant: "destructive"
      });
      return;
    }

    if (!selectedPropertyId) {
      toast({
        title: "Property Required",
        description: "Please select the property you want to view.",
        variant: "destructive"
      });
      return;
    }

    if (selectedDates.length === 0) {
      toast({
        title: "Dates Required",
        description: "Please select at least one preferred viewing date.",
        variant: "destructive"
      });
      return;
    }

    const filledTimes = timeRanges.filter(r => r.start && r.end).map(formatRange);
    if (filledTimes.length === 0) {
      toast({
        title: "Time Required",
        description: "Please pick at least one preferred time range.",
        variant: "destructive"
      });
      return;
    }

    // Submit the data
    onSubmit({
      dates: selectedDates,
      preferredTimes: filledTimes,
      specialRequirements: specialRequirements.trim(),
      selectedPropertyIds: [selectedPropertyId]
    });

    // Reset form
    setSelectedDates([]);
    setTimeRanges([{ start: '', end: '' }]);
    setSpecialRequirements('');
    setSelectedPropertyId('');
    onClose();
  };

  const handleCancel = () => {
    setSelectedDates([]);
    setTimeRanges([{ start: '', end: '' }]);
    setSpecialRequirements('');
    setSelectedPropertyId('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Book viewing</DialogTitle>
        </DialogHeader>

        {/* Allowance: one free trial booking on the free tier, 3 per cycle on
            premium, plus whatever pack credits the renter has bought. */}
        {quota && (
          quota.packRemaining > 0 ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-sm text-emerald-800">
              <CalendarCheck className="h-4 w-4 shrink-0" />
              <span>
                {quota.remaining} viewing coordination left, including {quota.packRemaining} from your viewing pack
                {quota.packExpiresAt ? ` (until ${format(new Date(quota.packExpiresAt), 'MMM dd, yyyy')})` : ''}.
              </span>
            </div>
          ) : quota.trialAvailable ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-sm text-emerald-800">
              <Gift className="h-4 w-4 shrink-0" />
              <span>
                This one is on us - your free viewing coordination. No card, no charge.
              </span>
            </div>
          ) : quota.remaining > 0 ? (
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
              {quota.remaining} of {quota.included} viewing bookings left.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
              <p>
                {quota.trialUsed
                  ? "You've used your free viewing coordination."
                  : `You've used all ${quota.included} of your viewing coordination.`}
              </p>
              <Button size="sm" onClick={purchaseViewingPack}>
                Viewing pack - {VIEWINGS_PER_PACK} coordination for $20
              </Button>
              <p className="text-xs text-amber-800/80">
                We'll book each visit with the realtor or owner for you.
              </p>
            </div>
          )
        )}

        <div className="space-y-6 py-4">
          {/* Property Selection - one listing per request, so the agent
              coordinates a single visit at a time. */}
          <div className="space-y-2">
            <Label>Select Property *</Label>
            <p className="text-xs text-muted-foreground">
              Choose the property you want to book a viewing for
            </p>
            <div className="max-h-[200px] overflow-y-auto border rounded-md p-3">
              {matchedProperties.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No matched properties available
                </p>
              ) : (
                <RadioGroup
                  value={selectedPropertyId}
                  onValueChange={setSelectedPropertyId}
                  className="space-y-2"
                >
                  {matchedProperties.map((property) => (
                    <div key={property.id} className="flex items-start space-x-3 p-2 rounded-lg hover:bg-accent/50 transition-colors">
                      <RadioGroupItem
                        id={`property-${property.id}`}
                        value={property.id}
                        className="mt-1"
                      />
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {property.images && property.images.length > 0 && (
                          <img loading="lazy"
                            src={property.images[0]}
                            alt={property.title}
                            className="w-16 h-16 object-cover rounded flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <label
                            htmlFor={`property-${property.id}`}
                            className="text-sm font-medium leading-tight cursor-pointer hover:text-primary block mb-1"
                            onClick={(e) => {
                              if (onPropertyClick) {
                                e.preventDefault();
                                onPropertyClick(property.id);
                              }
                            }}
                          >
                            {property.title}
                          </label>
                          {property.location && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {property.location}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              )}
            </div>
          </div>

          {/* Date Selection */}
          <div className="space-y-2">
            <Label>Preferred Viewing Dates *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    selectedDates.length === 0 && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDates.length > 0 
                    ? `${selectedDates.length} date${selectedDates.length > 1 ? 's' : ''} selected`
                    : "Select dates"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDates[0]}
                  onSelect={handleAddDate}
                  disabled={(date) => date < new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>

            {/* Display selected dates */}
            {selectedDates.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedDates.map((date, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 bg-primary/10 text-primary px-3 py-1 rounded-full text-sm"
                  >
                    {format(date, 'MMM dd, yyyy')}
                    <button
                      type="button"
                      onClick={() => handleRemoveDate(date)}
                      className="ml-1 hover:text-primary/70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Time Slots */}
          <div className="space-y-2">
            <Label>Preferred Times *</Label>
            <p className="text-xs text-muted-foreground">
              Pick a time range you are free within, e.g. 9:00 AM - 11:00 AM
            </p>
            {timeRanges.map((range, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  value={range.start}
                  onValueChange={(value) => handleTimeChange(index, 'start', value)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="From" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.slice(0, -1).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">to</span>
                <Select
                  value={range.end}
                  onValueChange={(value) => handleTimeChange(index, 'end', value)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="To" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.filter(o => !range.start || Number(o.value) > Number(range.start)).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {timeRanges.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleRemoveTimeSlot(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddTimeSlot}
              className="w-full"
            >
              + Add Another Time Range
            </Button>
          </div>

          {/* Special Requirements */}
          <div className="space-y-2">
            <Label htmlFor="requirements">Special Requirements (Optional)</Label>
            <Textarea
              id="requirements"
              placeholder="Any specific needs or preferences? (e.g., need parking access, prefer virtual tour first, wheelchair accessible)"
              value={specialRequirements}
              onChange={(e) => setSpecialRequirements(e.target.value)}
              maxLength={500}
              rows={4}
            />
            <p className="text-xs text-muted-foreground text-right">
              {specialRequirements.length}/500
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={quotaExhausted}>
            Submit Request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
