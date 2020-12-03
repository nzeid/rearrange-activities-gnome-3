
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Workspace = imports.ui.workspace;

let oldWindowCloneInit, oldWindowCloneOnKeyPress;
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
    this.actor.connect('key-release-event', Lang.bind(this, function (actor, event) {
      if(
        event.get_key_symbol() == Clutter.KEY_Shift_L
        || event.get_key_symbol() == Clutter.KEY_Shift_R
      ) {
        return !(this.raShiftDown = false);
      }
      return false;
    }));

  };

  // Overload the WindowClone key-press event handler:
  oldWindowCloneOnKeyPress = Workspace.WindowClone.prototype._onKeyPress;
  Workspace.WindowClone.prototype._onKeyPress = function(actor, event) {

    // Original function:
    if(oldWindowCloneOnKeyPress.apply(this, arguments)) {
      return true;
    }

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
    return false;
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
    for(i = 0; i < this._currentLayout.rows.length; ++i) {
      this._currentLayout.rows[i].windows.sort(function(a, b) {
        return orderedWindowsMap[a.metaWindow.raWindowId] - orderedWindowsMap[b.metaWindow.raWindowId];
      });
    }

    // Render the layout:
    this._updateWindowPositions(flags);

  };

}

function disable() {

  // Restore the original functions:
  Workspace.WindowClone.prototype._init = oldWindowCloneInit;
  Workspace.WindowClone.prototype._onKeyPress = oldWindowCloneOnKeyPress;
  Workspace.Workspace.prototype._realRecalculateWindowPositions = oldRealRecalculateWindowPositions;

}
