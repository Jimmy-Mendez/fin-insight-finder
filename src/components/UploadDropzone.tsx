import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface UploadDropzoneProps {
  onFiles: (files: FileList | null) => void;
}

export const UploadDropzone = ({ onFiles }: UploadDropzoneProps) => {
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload SEC PDFs</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`flex flex-col items-center justify-center border border-dashed rounded-md p-8 transition ${dragging ? 'bg-accent' : 'bg-background'}`}
        >
          <p className="text-sm text-muted-foreground mb-3">Drag & drop PDFs here, or</p>
          <Button variant="subtle" onClick={() => document.getElementById('file-input')?.click()}>Browse files</Button>
        </div>
      </CardContent>
    </Card>
  );
};
