import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarIcon, X, Infinity as InfinityIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useViewingQuota } from '@/hooks/useViewingQuota';

interface Property {
  id: string;
  title: string;
  images?: string[];
  location?: string;
  price?: number;
}

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
  const [preferredTimes, setPreferredTimes] = useState<string[]>(['']);
  const [specialRequirements, setSpecialRequirements] = useState('');
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>(initialSelectedIds ?? []);
  const { toast } = useToast();
  const { quota, purchaseUnlimitedMonth } = useViewingQuota();
  const quotaExhausted = !!quota && !quota.canBook;

  // Re-seed selection whenever modal opens or initial ids change
  useEffect(() => {
    if (isOpen) {
      setSelectedPropertyIds((initialSelectedIds ?? []).slice(0, 3));
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
    setPreferredTimes([...preferredTimes, '']);
  };

  const handleRemoveTimeSlot = (index: number) => {
    setPreferredTimes(preferredTimes.filter((_, i) => i !== index));
  };

  const handleTimeChange = (index: number, value: string) => {
    const newTimes = [...preferredTimes];
    newTimes[index] = value;
    setPreferredTimes(newTimes);
  };

  const handlePropertyToggle = (propertyId: string) => {
    setSelectedPropertyIds(prev => {
      if (prev.includes(propertyId)) {
        return prev.filter(id => id !== propertyId);
      } else {
        if (prev.length >= 3) {
          toast({
            title: "Maximum Properties Reached",
            description: "You can select up to 3 properties for fast track viewing.",
            variant: "destructive"
          });
          return prev;
        }
        return [...prev, propertyId];
      }
    });
  };

  const handleSubmit = () => {
    // Validation
    if (quotaExhausted) {
      toast({
        title: "Viewing limit reached",
        description: "You've used your 3 included viewings this cycle. Get unlimited viewings for 30 days to keep booking.",
        variant: "destructive"
      });
      return;
    }

    if (selectedPropertyIds.length === 0) {
      toast({
        title: "Properties Required",
        description: "Please select at least one property for viewing.",
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

    const filledTimes = preferredTimes.filter(t => t.trim() !== '');
    if (filledTimes.length === 0) {
      toast({
        title: "Time Required",
        description: "Please provide at least one preferred time.",
        variant: "destructive"
      });
      return;
    }

    // Submit the data
    onSubmit({
      dates: selectedDates,
      preferredTimes: filledTimes,
      specialRequirements: specialRequirements.trim(),
      selectedPropertyIds
    });

    // Reset form
    setSelectedDates([]);
    setPreferredTimes(['']);
    setSpecialRequirements('');
    setSelectedPropertyIds([]);
    onClose();
  };

  const handleCancel = () => {
    setSelectedDates([]);
    setPreferredTimes(['']);
    setSpecialRequirements('');
    setSelectedPropertyIds([]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Fast Track Viewing</DialogTitle>
          <DialogDescription>
            Hausto Agent will coordinate with up to 3 listing providers based on your preferences.
          </DialogDescription>
        </DialogHeader>

        {/* Viewing quota: 3 included per cycle; $20 add-on lifts the cap for 30 days */}
        {quota && (
          quota.unlimited ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-sm text-emerald-800">
              <InfinityIcon className="h-4 w-4 shrink-0" />
              <span>
                Unlimited viewings active until {quota.addonExpiresAt ? format(new Date(quota.addonExpiresAt), 'MMM dd, yyyy') : 'the end of your add-on'}.
              </span>
            </div>
          ) : quota.remaining > 0 ? (
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
              {quota.remaining} of {quota.included} included viewing bookings left this cycle.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
              <p>You've used your {quota.included} included viewings this cycle.</p>
              <Button size="sm" onClick={purchaseUnlimitedMonth}>
                Unlimited viewings for 30 days — $20
              </Button>
              <p className="text-xs text-amber-800/80">
                We'll coordinate as many viewings as you need until you settle on a home.
              </p>
            </div>
          )
        )}

        <div className="space-y-6 py-4">
          {/* Property Selection */}
          <div className="space-y-2">
            <Label>Select Properties (Up to 3) *</Label>
            <p className="text-xs text-muted-foreground">
              Choose the properties you want to schedule viewings for
            </p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-3">
              {matchedProperties.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No matched properties available
                </p>
              ) : (
                matchedProperties.map((property) => (
                  <div key={property.id} className="flex items-start space-x-3 p-2 rounded-lg hover:bg-accent/50 transition-colors">
                    <Checkbox
                      id={`property-${property.id}`}
                      checked={selectedPropertyIds.includes(property.id)}
                      onCheckedChange={() => handlePropertyToggle(property.id)}
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
                ))
              )}
            </div>
            {selectedPropertyIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedPropertyIds.length} of 3 properties selected
              </p>
            )}
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
              e.g., "Morning (9-11 AM)", "Afternoon (2-4 PM)", "Evening (6-8 PM)"
            </p>
            {preferredTimes.map((time, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  placeholder="Enter preferred time"
                  value={time}
                  onChange={(e) => handleTimeChange(index, e.target.value)}
                  maxLength={100}
                />
                {preferredTimes.length > 1 && (
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
              + Add Another Time Slot
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
