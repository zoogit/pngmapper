import { useState } from 'react'
import './PointSetManager.css'

function PointSetManager({
  locationSets,
  activeSetId,
  onSetActiveSet,
  onAddSet,
  onDeleteSet,
  onToggleVisibility,
  onToggleExpanded,
  onUpdateSetName
}) {
  const [editingSetId, setEditingSetId] = useState(null)
  const [editName, setEditName] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(true)

  const handleStartEdit = (set) => {
    setEditingSetId(set.id)
    setEditName(set.name)
  }

  const handleSaveEdit = (setId) => {
    if (editName.trim()) {
      onUpdateSetName(setId, editName.trim())
    }
    setEditingSetId(null)
    setEditName('')
  }

  const handleCancelEdit = () => {
    setEditingSetId(null)
    setEditName('')
  }

  const handleKeyDown = (e, setId) => {
    if (e.key === 'Enter') {
      handleSaveEdit(setId)
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  const getNextSetNumber = () => {
    const numbers = locationSets
      .map(set => {
        const match = set.name.match(/^Set (\d+)$/)
        return match ? parseInt(match[1]) : 0
      })
      .filter(n => n > 0)

    return numbers.length > 0 ? Math.max(...numbers) + 1 : locationSets.length + 1
  }

  const canDelete = locationSets.length > 1

  return (
    <div className="point-set-manager">
      <div
        className="section-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="section-title">Location Sets</h3>
        <button className="collapse-button">
          {isCollapsed ? '▼' : '▲'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="sets-list">
        {locationSets.map(set => (
          <div
            key={set.id}
            className={`set-item ${set.id === activeSetId ? 'active' : ''} ${set.expanded ? 'expanded' : ''}`}
          >
            {/* Set Header */}
            <div
              className="set-header"
              onClick={() => {
                onSetActiveSet(set.id)
                if (!set.expanded) {
                  onToggleExpanded(set.id)
                }
              }}
            >
              <div className="set-header-left">
                <button
                  className="expand-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleExpanded(set.id)
                  }}
                  aria-label={set.expanded ? 'Collapse' : 'Expand'}
                >
                  {set.expanded ? '▼' : '▶'}
                </button>

                {editingSetId === set.id ? (
                  <input
                    type="text"
                    className="set-name-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleSaveEdit(set.id)}
                    onKeyDown={(e) => handleKeyDown(e, set.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className="set-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleStartEdit(set)
                    }}
                  >
                    {set.name}
                  </span>
                )}

                <span className="location-count">
                  ({set.locations.length} location{set.locations.length !== 1 ? 's' : ''})
                </span>
              </div>

              <div className="set-header-actions">
                <button
                  className={`visibility-button ${set.visible ? 'visible' : 'hidden'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleVisibility(set.id)
                  }}
                  title={set.visible ? 'Hide on map' : 'Show on map'}
                  aria-label={set.visible ? 'Hide on map' : 'Show on map'}
                >
                  {set.visible ? '👁' : '👁‍🗨'}
                </button>

                {canDelete && (
                  <button
                    className="delete-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Delete "${set.name}"? This cannot be undone.`)) {
                        onDeleteSet(set.id)
                      }
                    }}
                    title="Delete set"
                    aria-label="Delete set"
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>

            {/* Set Content - shows when expanded */}
            {set.expanded && (
              <div className="set-content">
                <div className="set-info">
                  <div className="marker-preview" style={{
                    backgroundColor: set.markerStyles.markerColor,
                    width: '20px',
                    height: '20px',
                    borderRadius: set.markerStyles.markerShape === 'circle' ? '50%' : '0',
                    display: 'inline-block',
                    border: '2px solid #dee2e6'
                  }} />
                  <span className="marker-style-text">
                    {set.markerStyles.markerShape} marker
                  </span>
                </div>
                <button
                  className="edit-name-button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartEdit(set)
                  }}
                >
                  ✏ Rename
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add New Set Button */}
      {locationSets.length < 5 && (
        <button
          className="add-set-button"
          onClick={() => onAddSet(`Set ${getNextSetNumber()}`)}
        >
          + Add New Set
        </button>
      )}

      {locationSets.length >= 5 && (
        <p className="max-sets-notice">Maximum of 5 sets reached</p>
      )}
        </>
      )}
    </div>
  )
}

export default PointSetManager
