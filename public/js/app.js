// Confirm delete
function confirmDelete(name) {
  return confirm('Are you sure you want to delete ' + name + '?');
}

// Toggle an edit row or card edit state.
// Closes any other open edit before opening the new one.
function toggleEdit(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var isOpen = el.classList.contains('open');
  // Close all open edits
  document.querySelectorAll('.edit-row.open, .card-edit.open').forEach(function(e) {
    e.classList.remove('open');
  });
  document.querySelectorAll('.card-view.hidden-by-edit').forEach(function(e) {
    e.classList.remove('hidden-by-edit');
  });
  if (!isOpen) {
    el.classList.add('open');
    // If it's a card edit, hide the card view
    var card = el.closest('.card');
    if (card) {
      var view = card.querySelector('.card-view');
      if (view) view.classList.add('hidden-by-edit');
    }
  }
}

// Sidebar toggle for mobile
document.addEventListener('DOMContentLoaded', function() {
  var toggle = document.getElementById('sidebar-toggle');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.add('-translate-x-full');
      sidebar.classList.remove('translate-x-0');
    }
    if (overlay) overlay.classList.remove('active');
  }

  function openSidebar() {
    if (sidebar) {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('translate-x-0');
    }
    if (overlay) overlay.classList.add('active');
  }

  if (toggle && sidebar) {
    toggle.addEventListener('click', function() {
      var isOpen = sidebar.classList.contains('translate-x-0');
      if (isOpen) closeSidebar();
      else openSidebar();
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  // Auto-dismiss flash messages
  document.querySelectorAll('.flash').forEach(function(el) {
    setTimeout(function() { el.remove(); }, 5000);
  });
});

// Toggle clan select visibility based on role
function toggleClanSelect(select) {
  var clanDiv = select.closest('form').querySelector('[id*="clan"]') ||
                document.getElementById('new-user-clan');
  if (clanDiv) {
    clanDiv.style.display = select.value === 'admin' ? 'none' : '';
  }
}
