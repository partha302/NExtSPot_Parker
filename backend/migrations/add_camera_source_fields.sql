-- Migration: Add camera source fields to ai_camera_config table
-- This adds support for USB webcams in addition to IP webcams

USE `ai_parking`;

-- Add camera_source column if it doesn't exist
ALTER TABLE `ai_camera_config` 
ADD COLUMN IF NOT EXISTS `camera_source` enum('ip','usb') DEFAULT 'ip' 
COMMENT 'Camera source type: ip (network) or usb (local)' 
AFTER `camera_url`;

-- Add usb_device_index column if it doesn't exist
ALTER TABLE `ai_camera_config` 
ADD COLUMN IF NOT EXISTS `usb_device_index` int DEFAULT 0 
COMMENT 'USB device index for local webcams (usually 0 for first camera)' 
AFTER `camera_source`;

-- Add index for camera source for faster filtering
CREATE INDEX IF NOT EXISTS `idx_camera_source` ON `ai_camera_config` (`camera_source`);
