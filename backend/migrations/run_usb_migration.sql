-- Quick migration script to add USB camera support
-- Run this in MySQL Workbench or command line
-- This script is idempotent - safe to run multiple times

USE `ai_parking`;

-- Check and add camera_source column if it doesn't exist
SET @column_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = 'ai_parking' 
    AND TABLE_NAME = 'ai_camera_config' 
    AND COLUMN_NAME = 'camera_source'
);

SET @sql_add_source = IF(@column_exists = 0,
  'ALTER TABLE `ai_camera_config` 
   ADD COLUMN `camera_source` enum(''ip'',''usb'') DEFAULT ''ip'' 
   COMMENT ''Camera source type: ip (network) or usb (local)'' 
   AFTER `camera_url`',
  'SELECT ''Column camera_source already exists'' AS info'
);

PREPARE stmt FROM @sql_add_source;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and add usb_device_index column if it doesn't exist
SET @column_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = 'ai_parking' 
    AND TABLE_NAME = 'ai_camera_config' 
    AND COLUMN_NAME = 'usb_device_index'
);

SET @sql_add_index = IF(@column_exists = 0,
  'ALTER TABLE `ai_camera_config` 
   ADD COLUMN `usb_device_index` int DEFAULT 0 
   COMMENT ''USB device index for local webcams (usually 0 for first camera)'' 
   AFTER `camera_source`',
  'SELECT ''Column usb_device_index already exists'' AS info'
);

PREPARE stmt FROM @sql_add_index;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Update existing records to have camera_source set based on camera_url
UPDATE `ai_camera_config` 
SET `camera_source` = 
  CASE 
    WHEN `camera_url` LIKE 'usb:%' THEN 'usb'
    ELSE 'ip'
  END
WHERE `camera_url` IS NOT NULL 
  AND (`camera_source` IS NULL OR `camera_source` = 'ip');

-- Show final status
SELECT 
  '✅ Migration completed successfully!' AS status,
  COUNT(*) AS total_configs,
  SUM(CASE WHEN camera_source = 'ip' THEN 1 ELSE 0 END) AS ip_cameras,
  SUM(CASE WHEN camera_source = 'usb' THEN 1 ELSE 0 END) AS usb_cameras
FROM `ai_camera_config`;
