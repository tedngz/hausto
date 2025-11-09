import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface ViewingScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (scheduleData: ViewingScheduleData) => void;
}

export interface ViewingScheduleData {
  dates: Date[];
  preferredTimes: string[];
  specialRequirements: string;
}

export const ViewingScheduleModal = ({ isOpen, onClose, onSubmit }: ViewingScheduleModalProps) => {
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [preferredTimes, setPreferredTimes] = useState<string[]>(['']);
  const [specialRequirements, setSpecialRequirements] = useState('');
  const { toast } = useToast();

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

  const handleSubmit = () => {
    // Validation
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
      specialRequirements: specialRequirements.trim()
    });

    // Reset form
    setSelectedDates([]);
    setPreferredTimes(['']);
    setSpecialRequirements('');
    onClose();
  };

  const handleCancel = () => {
    setSelectedDates([]);
    setPreferredTimes(['']);
    setSpecialRequirements('');
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

        <div className="space-y-6 py-4">
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
          <Button onClick={handleSubmit}>
            Submit Request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
