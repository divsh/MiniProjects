function moveCellUp() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getActiveRange();
  var row = range.getRow();
  var col = range.getColumn();
  
  if (row === 1) return;
  
  var current = range.getValue();
  var aboveCell = sheet.getRange(row - 1, col);
  var above = aboveCell.getValue();
  
  aboveCell.setValue(current);
  range.setValue(above);
}

function moveCellDown() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getActiveRange();
  var row = range.getRow();
  var col = range.getColumn();
  
  var lastRow = sheet.getMaxRows();
  if (row === lastRow) return;
  
  var current = range.getValue();
  var belowCell = sheet.getRange(row + 1, col);
  var below = belowCell.getValue();
  
  belowCell.setValue(current);
  range.setValue(below);
}

function insertRowAtFirstBlank(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  for (let row = 1; row <= lastRow; row++) {
    const rowValues = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

    const isBlankRow = rowValues.every(value =>
      value === '' || value === null
    );

    if (isBlankRow) {
      sheet.insertRowBefore(row);
      return row;
    }
  }

  // If no completely blank row exists, append at bottom
  sheet.insertRowAfter(lastRow);
  return lastRow + 1;
}



function getTodaysRow()
{
const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet(); // Or use ss.getSheetByName('YourSheetName');
  const data = sheet.getDataRange().getValues();
  
  // 1. Get Today's Date (ignoring time)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todayRowIdx = -1;

  // 2. Find the row matching today's date in Column A
  for (let i = 0; i < data.length; i++) {
    const cellValue = data[i][0];

    if (Object.prototype.toString.call(cellValue) === '[object Date]' && !isNaN(cellValue)) {
      const cellDate = new Date(cellValue);
      cellDate.setHours(0, 0, 0, 0);

      if (cellDate.getTime() === today.getTime()) {
        todayRowIdx = i;
        break;
      }
    }
  }
return todayRowIdx;

}

function moveTaskFromRow(rowIdx, sheet, data) {

rowIdx = rowIdx-1;
  // Validate row index (cannot move if first row)
  if (rowIdx <= 0 || rowIdx >= data.length) return;

  const targetRowIdx = rowIdx - 1; // move to row above

  // Iterate through columns (skip Column A)
  for (let colIdx = 1; colIdx < data[rowIdx].length; colIdx++) {

    const cellContent = String(data[rowIdx][colIdx] || '');

    if (!cellContent.includes('-')) continue;

    const lines = cellContent.split('\n');
    const tasksToMove = [];
    const remainingText = [];

    // Separate task lines
    for (const line of lines) {
      if (line.trim().startsWith('-')) {
        tasksToMove.push(line);
      } else if (line.trim() !== '') {
        remainingText.push(line);
      }
    }

    if (tasksToMove.length === 0) continue;

    // Read target cell (row above)
    const targetRange = sheet.getRange(targetRowIdx + 1, colIdx + 1);
    const existingTargetContent = String(targetRange.getValue() || '');

    const newTargetContent = existingTargetContent
      ? existingTargetContent + '\n' + tasksToMove.join('\n')
      : tasksToMove.join('\n');

    // Write updates
    targetRange.setValue(newTargetContent);
    sheet.getRange(rowIdx + 1, colIdx + 1)
      .setValue(remainingText.join('\n'));
  }
}

function moveIncompleteTasksFromCurrentRow()
{
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet(); // Or use ss.getSheetByName('YourSheetName');
  const data = sheet.getDataRange().getValues();
 
  moveTaskFromRow(sheet.getActiveCell().getRow(),sheet,data);
   insertRowAtFirstBlank(sheet);
}

/**
 * Moves lines starting with "-" from today's row to tomorrow's row.
 * Set this to run on a daily time-driven trigger (for example, late evening).
 */
function moveIncompleteTasksToNextDay() {
  
  todayRowIdx = getTodaysRow();
function isDate(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value);
}


}
