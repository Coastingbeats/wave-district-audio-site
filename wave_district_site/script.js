document.addEventListener('DOMContentLoaded', function () {
  var emailCta = document.getElementById('emailCta');
  var baseEmail = 'wavedistrictla@gmail.com';

  function updateEmail() {
    if (!emailCta) return;
    var serviceBtn = document.querySelector('.survey-options[data-group="service"] .survey-pill.selected');
    var instrumentBtn = document.querySelector('.survey-options[data-group="instrument"] .survey-pill.selected');
    var service = serviceBtn ? serviceBtn.getAttribute('data-service') : null;
    var instrument = instrumentBtn ? instrumentBtn.getAttribute('data-instrument') : null;

    var subjectText = service ? ('Inquiry: ' + service) : 'Inquiry';
    if (instrument) { subjectText += ' (Cameron Davis - ' + instrument + ')'; }

    var bodyText = 'Hi, I\'m interested in ' + (service || 'your services');
    if (instrument) { bodyText += ' with Cameron Davis on ' + instrument; }
    bodyText += '. Here are some details about my project:\n\n';

    emailCta.href = 'mailto:' + baseEmail + '?subject=' + encodeURIComponent(subjectText) + '&body=' + encodeURIComponent(bodyText);
  }

  document.querySelectorAll('.survey-options').forEach(function (group) {
    var pills = group.querySelectorAll('.survey-pill');
    pills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        pills.forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        updateEmail();
      });
    });
  });

  /* --- Quote builder (pricing + stems + live total + mailto request) --- */
  function fmtMoney(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  document.querySelectorAll('.quote-section').forEach(function (section) {
    var lines = section.querySelectorAll('.service-line');
    var totalEl = section.querySelector('.quote-total');

    function lineTotal(line) {
      var price = parseFloat(line.getAttribute('data-price')) || 0;
      var isFlat = line.getAttribute('data-flat') === 'true';
      if (isFlat) return price;
      var stepVal = line.querySelector('.step-val');
      var qty = stepVal ? parseInt(stepVal.textContent, 10) || 1 : 1;
      return price * qty;
    }

    function recalcAll() {
      var grand = 0;
      lines.forEach(function (line) {
        var checkbox = line.querySelector('.svc-toggle');
        var totalSpan = line.querySelector('.service-line-total');
        var t = lineTotal(line);
        if (totalSpan) totalSpan.textContent = fmtMoney(t);
        if (checkbox && checkbox.checked) grand += t;
      });
      if (totalEl) totalEl.textContent = fmtMoney(grand);
    }

    lines.forEach(function (line) {
      var max = parseInt(line.getAttribute('data-max'), 10) || 9;
      var stepVal = line.querySelector('.step-val');
      var checkbox = line.querySelector('.svc-toggle');

      line.querySelectorAll('.step-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!stepVal) return;
          var current = parseInt(stepVal.textContent, 10) || 1;
          var delta = parseInt(btn.getAttribute('data-step'), 10) || 0;
          var next = Math.min(max, Math.max(1, current + delta));
          stepVal.textContent = next;
          if (checkbox) checkbox.checked = true;
          recalcAll();
        });
      });

      if (checkbox) {
        checkbox.addEventListener('change', recalcAll);
      }
    });

    recalcAll();

    var submitBtn = section.querySelector('.quote-submit-btn');
    var successEl = section.querySelector('.quote-success');

    function sendViaMailto(nameField, emailField, phoneField, detailsField, selectedLines, grand) {
      var bodyLines = [];
      bodyLines.push('Name: ' + (nameField ? nameField.value : ''));
      bodyLines.push('Email: ' + (emailField ? emailField.value : ''));
      bodyLines.push('Phone: ' + (phoneField ? phoneField.value : ''));
      bodyLines.push('');
      bodyLines.push('Requested services:');
      if (selectedLines.length) {
        selectedLines.forEach(function (l) {
          bodyLines.push('- ' + l.name + (l.qtyText || '') + ': ' + fmtMoney(l.total));
        });
      } else {
        bodyLines.push('- (none selected)');
      }
      bodyLines.push('');
      bodyLines.push('Estimated Total: ' + fmtMoney(grand));
      bodyLines.push('');
      bodyLines.push('Project details:');
      bodyLines.push(detailsField ? detailsField.value : '');

      var subject = 'Quote Request - Wave District Audio';
      var mailto = 'mailto:' + baseEmail + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(bodyLines.join('\n'));
      window.location.href = mailto;
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var nameField = section.querySelector('.q-name');
        var emailField = section.querySelector('.q-email');
        var phoneField = section.querySelector('.q-phone');
        var detailsField = section.querySelector('.q-details');

        var selectedLines = [];
        var grand = 0;
        lines.forEach(function (line) {
          var checkbox = line.querySelector('.svc-toggle');
          if (checkbox && checkbox.checked) {
            var name = line.getAttribute('data-name') || 'Service';
            var t = lineTotal(line);
            var stepVal = line.querySelector('.step-val');
            var isFlat = line.getAttribute('data-flat') === 'true';
            var qtyText = (!isFlat && stepVal) ? (' x' + stepVal.textContent) : '';
            selectedLines.push({ name: name, total: t, qtyText: qtyText });
            grand += t;
          }
        });

        if (!selectedLines.length) {
          sendViaMailto(nameField, emailField, phoneField, detailsField, selectedLines, grand);
          if (successEl) successEl.hidden = false;
          return;
        }

        var email = emailField ? emailField.value.trim() : '';
        if (!email) {
          sendViaMailto(nameField, emailField, phoneField, detailsField, selectedLines, grand);
          if (successEl) successEl.hidden = false;
          return;
        }

        submitBtn.disabled = true;
        var originalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Sending...';

        fetch('/api/create-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nameField ? nameField.value : '',
            email: email,
            phone: phoneField ? phoneField.value : '',
            details: detailsField ? detailsField.value : '',
            lines: selectedLines.map(function (l) { return { name: l.name, total: l.total }; }),
          }),
        }).then(function (res) {
          return res.json().then(function (json) { return { ok: res.ok, json: json }; });
        }).then(function (result) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
          if (result.ok && result.json.success) {
            if (successEl) {
              successEl.textContent = 'Thanks! A 50% deposit invoice has been emailed to ' + email + ' via Stripe — we’ll follow up shortly.';
              successEl.hidden = false;
            }
          } else {
            // Fall back to email so the request still reaches us even if Stripe isn't wired up yet.
            sendViaMailto(nameField, emailField, phoneField, detailsField, selectedLines, grand);
            if (successEl) successEl.hidden = false;
          }
        }).catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
          sendViaMailto(nameField, emailField, phoneField, detailsField, selectedLines, grand);
          if (successEl) successEl.hidden = false;
        });
      });
    }
  });
});
