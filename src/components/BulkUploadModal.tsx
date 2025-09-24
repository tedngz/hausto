import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBulkImport } from '@/hooks/useBulkImport';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ExcelProperty {
  location: string;
  price: number;
  size?: string;
  title?: string;
  description?: string;
  vibe?: string;
  highlights?: string;
  image_urls?: string;
}

const sampleData = [
  {
    location: "123 Oak Street, Downtown",
    price: 2500,
    size: "120 sqm",
    title: "Modern Downtown Apartment",
    description: "Spacious apartment in the heart of the city",
    vibe: "Urban Professional",
    highlights: "24/7 Security, Gym, Rooftop Terrace",
    image_urls: "https://example.com/image1.jpg,https://example.com/image2.jpg"
  },
  {
    location: "456 Maple Avenue, Suburbs", 
    price: 1800,
    size: "95 sqm",
    title: "Cozy Suburban Home",
    description: "Perfect for families, quiet neighborhood",
    vibe: "Family Friendly",
    highlights: "Garden, Parking, Near Schools",
    image_urls: "https://example.com/image3.jpg"
  }
];

export const BulkUploadModal = ({ isOpen, onClose, onSuccess }: BulkUploadModalProps) => {
  const { user } = useAuth();
  const { bulkImportProperties, isImporting, progress } = useBulkImport();
  const [parsedData, setParsedData] = useState<ExcelProperty[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Properties");
    XLSX.writeFile(wb, "property_template.xlsx");
  };

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelProperty[];
        
        if (jsonData.length === 0) {
          toast.error('Excel file is empty or has no valid data');
          return;
        }

        // Validate required fields
        const validData = jsonData.filter(item => item.location && item.price);
        if (validData.length !== jsonData.length) {
          toast.warning(`Filtered out ${jsonData.length - validData.length} invalid rows. Location and price are required.`);
        }

        setParsedData(validData);
        toast.success(`Parsed ${validData.length} properties from Excel file`);
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        toast.error('Failed to parse Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleBulkUpload = async () => {
    if (!user || parsedData.length === 0) return;

    try {
      // Convert Excel format to CrawledProperty format
      const crawledProperties = parsedData.map(item => ({
        location: item.location,
        price: Number(item.price),
        size: item.size || '',
        realtor_id: user.id,
        title: item.title,
        description: item.description, 
        vibe: item.vibe,
        highlights: item.highlights ? item.highlights.split(',').map(h => h.trim()) : undefined,
        images: item.image_urls ? item.image_urls.split(',').map(url => url.trim()) : []
      }));

      const result = await bulkImportProperties(crawledProperties);
      setLastResult(result);
      
      if (result.successful > 0) {
        toast.success(`Successfully imported ${result.successful} properties!`);
        onSuccess?.();
      }
    } catch (error) {
      console.error('Bulk import error:', error);
      toast.error('Failed to import properties. Please try again.');
    }
  };

  const resetModal = () => {
    setParsedData([]);
    setLastResult(null);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Bulk Property Upload
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Download Template */}
          <Card className="p-4 bg-blue-50 border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-blue-900">Download Template</h3>
                <p className="text-sm text-blue-700">Get the Excel template with the correct format</p>
              </div>
              <Button onClick={downloadTemplate} variant="outline" className="border-blue-300">
                <Download className="w-4 h-4 mr-2" />
                Download Template
              </Button>
            </div>
          </Card>

          {/* File Upload */}
          <Card className="p-6">
            <div className="text-center">
              <FileSpreadsheet className="w-16 h-16 mx-auto mb-4 text-slate-400" />
              <h3 className="text-lg font-medium mb-2">Upload Excel File</h3>
              <p className="text-slate-600 mb-4">Select an Excel file containing property data</p>
              
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                id="excel-upload"
              />
              <label htmlFor="excel-upload">
                <Button className="cursor-pointer" asChild>
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    Choose Excel File
                  </span>
                </Button>
              </label>
            </div>
          </Card>

          {/* Parsed Data Preview */}
          {parsedData.length > 0 && (
            <Card className="p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Parsed Data Preview ({parsedData.length} properties)
              </h3>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {parsedData.slice(0, 5).map((item, index) => (
                  <div key={index} className="p-3 bg-slate-50 rounded border">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">{item.title || item.location}</p>
                        <p className="text-sm text-slate-600">{item.location}</p>
                      </div>
                      <Badge>${item.price}/mo</Badge>
                    </div>
                  </div>
                ))}
                {parsedData.length > 5 && (
                  <p className="text-sm text-slate-600 text-center">
                    ... and {parsedData.length - 5} more properties
                  </p>
                )}
              </div>
              
              <div className="mt-4 flex gap-2">
                <Button onClick={handleBulkUpload} disabled={isImporting} className="flex-1">
                  {isImporting ? 'Processing...' : `Import ${parsedData.length} Properties`}
                </Button>
                <Button variant="outline" onClick={resetModal}>
                  Clear
                </Button>
              </div>
            </Card>
          )}

          {/* Progress */}
          {progress && (
            <Card className="p-4">
              <h3 className="font-medium mb-3">Import Progress</h3>
              <Progress 
                value={(progress.completed / progress.total) * 100} 
                className="mb-2"
              />
              <div className="flex justify-between text-sm text-slate-600">
                <span>{progress.completed} / {progress.total} processed</span>
                <span>{progress.successful} successful, {progress.failed} failed</span>
              </div>
            </Card>
          )}

          {/* Results */}
          {lastResult && (
            <Card className="p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                {lastResult.successful > 0 ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                )}
                Import Results
              </h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{lastResult.processed}</div>
                  <div className="text-sm text-slate-600">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{lastResult.successful}</div>
                  <div className="text-sm text-slate-600">Successful</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{lastResult.failed}</div>
                  <div className="text-sm text-slate-600">Failed</div>
                </div>
              </div>
            </Card>
          )}

          {/* Instructions */}
          <Card className="p-4 bg-slate-50">
            <h3 className="font-medium mb-2">Excel Format Requirements</h3>
            <ul className="text-sm text-slate-600 space-y-1">
              <li>• <strong>location</strong>: Property address (required)</li>
              <li>• <strong>price</strong>: Monthly rent amount (required)</li>
              <li>• <strong>size</strong>: Property size (optional)</li>
              <li>• <strong>title</strong>: Property title (optional - AI will generate if empty)</li>
              <li>• <strong>description</strong>: Property description (optional - AI will generate if empty)</li>
              <li>• <strong>vibe</strong>: Property vibe/style (optional - AI will generate if empty)</li>
              <li>• <strong>highlights</strong>: Comma-separated features (optional - AI will generate if empty)</li>
              <li>• <strong>image_urls</strong>: Comma-separated image URLs (optional)</li>
            </ul>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
};