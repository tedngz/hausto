/**
 * Converts AVIF images to PNG format for OpenAI compatibility
 */
export const convertAvifToPng = async (file: File): Promise<File> => {
  // Only convert AVIF files
  if (!file.type.includes('avif')) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      try {
        // Set canvas dimensions to match image
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        // Draw the image on canvas
        ctx?.drawImage(img, 0, 0);

        // Convert canvas to PNG blob
        canvas.toBlob((blob) => {
          if (blob) {
            // Create new File object with PNG format
            const originalName = file.name.replace(/\.(avif|AVIF)$/, '');
            const pngFile = new File([blob], `${originalName}.png`, {
              type: 'image/png',
              lastModified: Date.now()
            });
            resolve(pngFile);
          } else {
            reject(new Error('Failed to convert AVIF to PNG'));
          }
        }, 'image/png', 0.9);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load AVIF image'));
    };

    // Create object URL for the AVIF file
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Process and convert multiple files if needed
 */
export const processImageFiles = async (files: File[]): Promise<File[]> => {
  const processedFiles: File[] = [];
  
  for (const file of files) {
    try {
      const convertedFile = await convertAvifToPng(file);
      processedFiles.push(convertedFile);
    } catch (error) {
      console.error(`Failed to process file ${file.name}:`, error);
      // Fallback to original file if conversion fails
      processedFiles.push(file);
    }
  }
  
  return processedFiles;
};