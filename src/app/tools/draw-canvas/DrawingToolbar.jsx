'use client';

import { Eraser, DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

// Color presets
const COLOR_PRESETS = [
  { name: 'Black', value: '#000000' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Gray', value: '#6b7280' }
];

export default function DrawingToolbar({
  // Drawing controls
  currentColor,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  imageSize,
  onImageSizeChange,

  // View controls
  showImages,
  onShowImagesChange,
  showGrid,
  onShowGridChange,

  // Action buttons
  onUpload,
  onClear,
  onSave,

  // Button visibility
  showUploadButton = true,
  showClearButton = true,
  showSaveButton = true
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 px-6 py-3 flex items-center gap-6">
      {/* Left Section - Drawing Controls */}
      <div className="flex items-center gap-4">
        {/* Color Dropdown */}
        <Select value={currentColor} onValueChange={onColorChange}>
          <SelectTrigger className="w-[110px] h-9">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full border border-slate-300"
                style={{ backgroundColor: currentColor }}
              />
              <span className="text-sm">
                {COLOR_PRESETS.find(c => c.value === currentColor)?.name || 'Color'}
              </span>
            </div>
          </SelectTrigger>
          <SelectContent>
            {COLOR_PRESETS.map((color) => (
              <SelectItem key={color.value} value={color.value}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full border border-slate-300"
                    style={{ backgroundColor: color.value }}
                  />
                  <span>{color.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Stroke Width Slider */}
        <input
          type="range"
          min="1"
          max="20"
          value={strokeWidth}
          onChange={(e) => onStrokeWidthChange(parseInt(e.target.value))}
          className="w-24 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
          aria-label="Tip size"
          title={`Stroke width: ${strokeWidth}px`}
        />
        <span className="text-sm text-slate-600">Tip</span>
      </div>

      <Separator orientation="vertical" className="h-8" />

      {/* Middle Section - View Controls */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>Image</span>
          <input
            type="range"
            min="200"
            max="1200"
            step="10"
            value={imageSize}
            onChange={(e) => onImageSizeChange(parseInt(e.target.value, 10))}
            className="w-24 h-2 cursor-pointer appearance-none rounded-lg bg-slate-200"
            aria-label="Image size"
          />
        </label>

        {/* Toggle Images */}
        <div className="flex items-center gap-2">
          <Switch
            checked={showImages}
            onCheckedChange={onShowImagesChange}
            id="toggle-images"
          />
          <label
            htmlFor="toggle-images"
            className="text-sm text-slate-600 cursor-pointer"
          >
            Image
          </label>
        </div>

        {/* Toggle Grid Pattern */}
        <div className="flex items-center gap-2">
          <Switch
            checked={showGrid}
            onCheckedChange={onShowGridChange}
            id="toggle-grid"
          />
          <label
            htmlFor="toggle-grid"
            className="text-sm text-slate-600 cursor-pointer"
          >
            Grid
          </label>
        </div>
      </div>

      <Separator orientation="vertical" className="h-8" />

      {/* Right Section - Action Buttons */}
      <div className="flex items-center gap-3">
        {showUploadButton && (
          <Button
            onClick={onUpload}
            variant="secondary"
            size="sm"
            title="Upload image"
          >
            <UploadSimple weight="bold" className="w-4 h-4" />
          </Button>
        )}

        {showClearButton && (
          <Button
            onClick={onClear}
            variant="secondary"
            size="sm"
            title="Clear drawings"
          >
            <Eraser weight="bold" className="w-4 h-4" />
          </Button>
        )}

        {showSaveButton && (
          <Button
            onClick={onSave}
            size="sm"
            title="Save drawing"
          >
            <DownloadSimple weight="bold" className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
