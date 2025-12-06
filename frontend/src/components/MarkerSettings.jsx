import { useState } from 'react'
import './MarkerSettings.css'

function MarkerSettings({ markerStyles, onStylesChange }) {
  const [isExpanded, setIsExpanded] = useState(false)

  console.log('MarkerSettings component loaded', markerStyles)

  const handleChange = (key, value) => {
    console.log(`MARKERSETTINGS - Changing ${key} to:`, value)
    const newStyles = {
      ...markerStyles,
      [key]: value
    }
    console.log('MARKERSETTINGS - New full styles object:', newStyles)
    onStylesChange(newStyles)
  }

  return (
    <div className="marker-settings">
      <button
        className="settings-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? '▼' : '▶'} Marker Style Settings
      </button>

      {isExpanded && (
        <div className="settings-panel">
          <div className="setting-group">
            <label>
              <input
                type="checkbox"
                checked={markerStyles.showFill}
                onChange={(e) => handleChange('showFill', e.target.checked)}
              />
              <span>Show Fill</span>
            </label>
          </div>

          {markerStyles.showFill && (
            <div className="setting-group">
              <label>
                <span>Marker Color</span>
                <input
                  type="color"
                  value={markerStyles.markerColor}
                  onChange={(e) => handleChange('markerColor', e.target.value)}
                />
              </label>
            </div>
          )}

          <div className="setting-group">
            <label>
              <span>Marker Shape</span>
              <select
                value={markerStyles.markerShape}
                onChange={(e) => handleChange('markerShape', e.target.value)}
              >
                <option value="circle">Circle</option>
                <option value="square">Square</option>
                <option value="triangle">Triangle</option>
                <option value="star">Star</option>
              </select>
            </label>
          </div>

          <div className="setting-group">
            <label>
              <span>Marker Size (inches)</span>
              <input
                type="number"
                min="0.1"
                max="1.0"
                step="0.1"
                value={markerStyles.markerSize}
                onChange={(e) => handleChange('markerSize', parseFloat(e.target.value))}
              />
            </label>
          </div>

          <div className="setting-group">
            <label>
              <input
                type="checkbox"
                checked={markerStyles.showOutline}
                onChange={(e) => handleChange('showOutline', e.target.checked)}
              />
              <span>Show Outline</span>
            </label>
          </div>

          {markerStyles.showOutline && (
            <>
              <div className="setting-group">
                <label>
                  <span>Outline Color</span>
                  <input
                    type="color"
                    value={markerStyles.outlineColor}
                    onChange={(e) => handleChange('outlineColor', e.target.value)}
                  />
                </label>
              </div>

              <div className="setting-group">
                <label>
                  <span>Outline Width (pt)</span>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.5"
                    value={markerStyles.outlineWidth}
                    onChange={(e) => handleChange('outlineWidth', parseFloat(e.target.value))}
                  />
                </label>
              </div>
            </>
          )}

          <div className="setting-group">
            <label>
              <input
                type="checkbox"
                checked={markerStyles.showShadow}
                onChange={(e) => handleChange('showShadow', e.target.checked)}
              />
              <span>Show Shadow</span>
            </label>
          </div>

          <div className="setting-group">
            <label>
              <input
                type="checkbox"
                checked={markerStyles.showLabels}
                onChange={(e) => handleChange('showLabels', e.target.checked)}
              />
              <span>Show Labels</span>
            </label>
          </div>

          {markerStyles.showLabels && (
            <>
              <div className="setting-group">
                <label>
                  <span>Label Font Size (pt)</span>
                  <input
                    type="number"
                    min="6"
                    max="20"
                    step="1"
                    value={markerStyles.labelFontSize}
                    onChange={(e) => handleChange('labelFontSize', parseInt(e.target.value))}
                  />
                </label>
              </div>

              <div className="setting-group">
                <label>
                  <span>Label Text Color</span>
                  <input
                    type="color"
                    value={markerStyles.labelTextColor}
                    onChange={(e) => handleChange('labelTextColor', e.target.value)}
                  />
                </label>
              </div>

              <div className="setting-group">
                <label>
                  <span>Label Background Color</span>
                  <input
                    type="color"
                    value={markerStyles.labelBgColor}
                    onChange={(e) => handleChange('labelBgColor', e.target.value)}
                  />
                </label>
              </div>

              <div className="setting-group">
                <label>
                  <input
                    type="checkbox"
                    checked={markerStyles.labelBold}
                    onChange={(e) => handleChange('labelBold', e.target.checked)}
                  />
                  <span>Bold Labels</span>
                </label>
              </div>
            </>
          )}

          <button
            className="reset-button"
            onClick={() => onStylesChange({
              markerColor: '#dc3545',
              markerShape: 'circle',
              markerSize: 0.2,
              showFill: true,
              outlineColor: '#ffffff',
              outlineWidth: 1,
              showOutline: true,
              showShadow: false,
              showLabels: true,
              labelFontSize: 10,
              labelTextColor: '#000000',
              labelBgColor: '#ffffff',
              labelBold: true
            })}
          >
            Reset to Defaults
          </button>
        </div>
      )}
    </div>
  )
}

export default MarkerSettings
