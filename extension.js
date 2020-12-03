
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Workspace = imports.ui.workspace;

let oldWindowCloneInit;
let oldComputeLayout;
let oldRealRecalculateWindowPositions;
let uniqueId = 0;
let workspaces = {};

function init() {
}

function enable() {

  // Overload the WindowClone constructor:
  oldWindowCloneInit = Workspace.WindowClone.prototype._init;
  Workspace.WindowClone.prototype._init = function(realWindow, workspace) {

    // Original constructor:
    oldWindowCloneInit.apply(this, arguments);

    let id;

    // Generate a unique ID for the given workspace:
    if(
      typeof this._workspace.metaWorkspace.raWorkspaceId !== 'string'
      || workspaces[this._workspace.metaWorkspace.raWorkspaceId] === undefined
    ) {
      while(workspaces[(id = "#" + (++uniqueId))] !== undefined);
      this._workspace.metaWorkspace.raWorkspaceId = id;
      workspaces[id] = {
        windowsMap: {},
        windowsOrder: []
      };
    }

    // Generate a unique ID for the given window:
    let workspaceId = this._workspace.metaWorkspace.raWorkspaceId;
    if(
      typeof this.metaWindow.raWindowId !== 'string'
      || workspaces[workspaceId]["windowsMap"][this.metaWindow.raWindowId] === undefined
    ) {
      while(workspaces[workspaceId].windowsMap[(id = "#" + (++uniqueId))] !== undefined);
      this.metaWindow.raWindowId = id;
      workspaces[workspaceId].windowsMap[id] = true;
      workspaces[workspaceId].windowsOrder.push(id);
    }

    // Detect that the shift key has been released:
    this.connect('key-release-event', Lang.bind(this, function (actor, event) {
      if(
        event.get_key_symbol() == Clutter.KEY_Shift_L
        || event.get_key_symbol() == Clutter.KEY_Shift_R
      ) {
        return !(this.raShiftDown = false);
      }
      return false;
    }));

    // Window rearrangement trigger:
    this.connect('key-press-event', Lang.bind(this, function (actor, event) {
      // Detect that the shift key has been pressed:
      if(
        event.get_key_symbol() == Clutter.KEY_Shift_L
        || event.get_key_symbol() == Clutter.KEY_Shift_R
      ) {
        return (this.raShiftDown = true);
      }

      // If the shift key is down:
      if(this.raShiftDown) {

        // Move the target window left in the arrangement:
        if(event.get_key_symbol() == Clutter.KEY_Left) {
          let workspaceId = this._workspace.metaWorkspace.raWorkspaceId;
          let windowId = this.metaWindow.raWindowId;
          let i = workspaces[workspaceId].windowsOrder.length;
          while(i-- > 1) {
            if(windowId === workspaces[workspaceId].windowsOrder[i]) {
              workspaces[workspaceId].windowsOrder[i] = workspaces[workspaceId].windowsOrder[i - 1];
              workspaces[workspaceId].windowsOrder[i - 1] = windowId;
              this._workspace._recalculateWindowPositions(0);
              break;
            }
          }
          return true;
        }

        // Move the target window right in the arrangement:
        if(event.get_key_symbol() == Clutter.KEY_Right) {
          let workspaceId = this._workspace.metaWorkspace.raWorkspaceId;
          let windowId = this.metaWindow.raWindowId;
          let i = workspaces[workspaceId].windowsOrder.length;
          if(i-- > 1) {
            do {
              if(windowId === workspaces[workspaceId].windowsOrder[--i]) {
                workspaces[workspaceId].windowsOrder[i] = workspaces[workspaceId].windowsOrder[i + 1];
                workspaces[workspaceId].windowsOrder[i + 1] = windowId;
                this._workspace._recalculateWindowPositions(0);
                break;
              }
            }
            while(i > 0);
          }
          return true;
        }

      }

      // Otherwise do nothing:
      return false;

    }));

  };

  /*
    We shim "computeLayout" solely to eliminate the sorting of windows by
    vertical height. This was interfering with the addon when the window
    heights weren't all the same.
  */
  oldComputeLayout = Workspace.UnalignedLayoutStrategy.prototype.computeLayout;
  Workspace.UnalignedLayoutStrategy.prototype.computeLayout = function (windows, layout) {
    let numRows = layout.numRows;
    let rows = [];
    let totalWidth = 0;
    for(let i = 0; i < windows.length; i++) {
      let window = windows[i];
      let s = this._computeWindowScale(window);
      totalWidth += window.width * s;
    }
    let idealRowWidth = totalWidth / numRows;

    // This is where the change was made:
    let sortedWindows = windows.slice();

    let windowIdx = 0;
    for(let i = 0; i < numRows; i++) {
      let row = this._newRow();
      rows.push(row);
      for(; windowIdx < sortedWindows.length; windowIdx++) {
        let window = sortedWindows[windowIdx];
        let s = this._computeWindowScale(window);
        let width = window.width * s;
        let height = window.height * s;
        row.fullHeight = Math.max(row.fullHeight, height);
        // either new width is < idealWidth or new width is nearer from idealWidth then oldWidth
        if(this._keepSameRow(row, window, width, idealRowWidth) || (i == numRows - 1)) {
          row.windows.push(window);
          row.fullWidth += width;
        }
        else {
          break;
        }
      }
    }
    let gridHeight = 0;
    let maxRow;
    for(let i = 0; i < numRows; i++) {
      let row = rows[i];
      this._sortRow(row);
      if(!maxRow || row.fullWidth > maxRow.fullWidth)
        maxRow = row;
      gridHeight += row.fullHeight;
    }
    layout.rows = rows;
    layout.maxColumns = maxRow.windows.length;
    layout.gridWidth = maxRow.fullWidth;
    layout.gridHeight = gridHeight;
  };

  // Overload the window overlay rendering function:
  oldRealRecalculateWindowPositions = Workspace.Workspace.prototype._realRecalculateWindowPositions;
  Workspace.Workspace.prototype._realRecalculateWindowPositions = function(flags) {

    // This is part of the original process:
    if(this._repositionWindowsId > 0) {
      Mainloop.source_remove(this._repositionWindowsId);
      this._repositionWindowsId = 0;
    }
    let currentWindows = this._windows.slice();
    if(currentWindows.length == 0)
      return;
    if(this._reservedSlot)
      currentWindows.push(this._reservedSlot);

    // Iterate over the current workspace's windows to build a map that will
    // be used to update our own arrangement:
    let workspace = workspaces[this.metaWorkspace.raWorkspaceId];
    let givenWindowsMap = {};
    let i = 0;
    let id;
    for(; i < currentWindows.length; ++i) {
      id = currentWindows[i].metaWindow.raWindowId;
      givenWindowsMap[id] = currentWindows[i];
      // If a new window has appeared, it must be added:
      if(workspace.windowsMap[id] === undefined) {
        workspace.windowsMap[id] = true;
        workspace.windowsOrder.push(id);
      }
    }

    // Update our arrangement to have the same set of windows as the upcoming
    // layout, but without disrupting our order:
    let orderedWindowsMap = {};
    let orderedWindows = [];
    i = 0;
    while(i < workspace.windowsOrder.length) {
      id = workspace.windowsOrder[i];
      // If an old window has disappeared, it must be removed:
      if(givenWindowsMap[id] === undefined) {
        delete workspace.windowsMap[id];
        workspace.windowsOrder.splice(i, 1);
      }
      else {
        orderedWindowsMap[id] = orderedWindows.length;
        orderedWindows.push(givenWindowsMap[id]);
        ++i;
      }
    }

    // The original call to generate the layout:
    this._currentLayout = this._computeLayout(orderedWindows);

    // Because the layout generation borks our order, we have to sort again:
    let coordinates = [];
    let j;
    for(i = 0; i < this._currentLayout.rows.length; ++i) {
      for(j = 0; j < this._currentLayout.rows[i].windows.length; ++j) {
        coordinates.push([i, j]);
      }
    }
    for(i = 0; i < coordinates.length; ++i) {
      this._currentLayout.rows[coordinates[i][0]].windows[coordinates[i][1]] = orderedWindows[i];
    }

    // Render the layout:
    this._updateWindowPositions(flags);

  };

}

function disable() {

  // Restore the original functions:
  Workspace.WindowClone.prototype._init = oldWindowCloneInit;
  Workspace.UnalignedLayoutStrategy.prototype.computeLayout = oldComputeLayout;
  Workspace.Workspace.prototype._realRecalculateWindowPositions = oldRealRecalculateWindowPositions;

}
