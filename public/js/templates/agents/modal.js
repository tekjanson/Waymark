/* ============================================================
   templates/agents/modal.js — Delete confirmation modal
   ============================================================ */

import { el, showToast } from '../shared.js';
import { api } from '../../api-client.js';

/** Build delete confirmation modal element
 * @returns {Element}
 */
export function buildDeleteModal() {
  const deleteModal = el('div', {
    className: 'agents-delete-modal hidden',
    on: { click(e) {
      if (e.target === deleteModal) deleteModal.classList.add('hidden');
    }},
  }, [
    el('div', { className: 'agents-delete-modal-content' }, [
      el('div', { className: 'agents-delete-modal-header' }, [
        el('h3', { className: 'agents-delete-modal-title' }, ['Delete Agent']),
        el('button', {
          className: 'agents-delete-modal-close',
          on: { click() { deleteModal.classList.add('hidden'); }},
        }, ['×']),
      ]),
      el('div', { className: 'agents-delete-modal-body' }, [
        el('p', {}, [
          'Are you sure you want to delete ',
          el('strong', { className: 'agents-delete-agent-name' }, ['Agent']),
          '? This will remove them from the registry.',
        ]),
      ]),
      el('div', { className: 'agents-delete-modal-footer' }, [
        el('button', {
          className: 'agents-delete-modal-cancel',
          on: { click() { deleteModal.classList.add('hidden'); }},
        }, ['Cancel']),
        el('button', {
          className: 'agents-confirm-delete-btn',
        }, ['Delete']),
      ]),
    ]),
  ]);

  return deleteModal;
}

/** Set up delete modal confirmation handler
 * @param {Element} deleteModal - The modal element
 * @param {string} agentName - Name of the agent to delete
 * @param {number} rowIdx - 1-based row index
 * @param {Object} template - Template instance reference
 */
export async function setupDeleteConfirmation(deleteModal, agentName, rowIdx, template) {
  const deleteAgentName = deleteModal.querySelector('.agents-delete-agent-name');
  const confirmDeleteBtn = deleteModal.querySelector('.agents-confirm-delete-btn');

  deleteAgentName.textContent = agentName;

  confirmDeleteBtn.onclick = async () => {
    try {
      // Delete the row from the sheet (rowIdx is 1-based in sheet coordinates)
      const sheetId = template._currentNumericSheetId ?? 0;
      const sheetTitle = template._currentSheetTitle || 'Sheet1';
      const spreadsheetId = template._currentSheetId;
      
      if (!spreadsheetId) {
        showToast('Could not delete: spreadsheet ID not available', 'error');
        deleteModal.classList.add('hidden');
        return;
      }

      // Use batchUpdate to delete the row
      await api.sheets.deleteRows(spreadsheetId, sheetId, rowIdx, rowIdx + 1);
      showToast(`Agent "${agentName}" deleted`, 'success');
      deleteModal.classList.add('hidden');
      
      // Reload the sheet to reflect changes
      setTimeout(() => window.location.hash = window.location.hash, 100);
    } catch (err) {
      showToast(`Failed to delete agent: ${err.message}`, 'error');
      deleteModal.classList.add('hidden');
    }
  };

  deleteModal.classList.remove('hidden');
}
