/* ============================================================================
   auth.js
   ----------------------------------------------------------------------------
   Responsável por: login (admin e cliente), cadastro de cliente e
   manutenção da sessão ("permanecer autenticado" via localStorage).
   ============================================================================ */

(function (global) {
  'use strict';

  function setButtonLoading(button, loading, loadingText) {
    if (!button) return;
    if (loading) {
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText || 'Aguarde...'}`;
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.originalText || button.innerHTML;
      button.disabled = false;
    }
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    form.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
  }

  function showFieldError(input, message) {
    input.classList.add('has-error');
    const err = document.createElement('span');
    err.className = 'field-error';
    err.textContent = message;
    input.closest('.form-field').appendChild(err);
  }

  // --------------------------------------------------------------------------
  // LOGIN
  // --------------------------------------------------------------------------
  function handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    clearFieldErrors(form);

    const email = form.email.value.trim();
    const password = form.password.value;
    const submitBtn = form.querySelector('button[type="submit"]');

    if (!email || !password) {
      Utils.showToast('Preencha e-mail e senha para continuar.', 'warning');
      return;
    }

    setButtonLoading(submitBtn, true, 'Entrando...');

    DataService.Auth.login(email, password)
      .then((user) => DataService.Auth.saveSession(user).then(() => user))
      .then((user) => {
        global.App.setCurrentUser(user);
        form.reset();
        Utils.showToast(`Bem-vindo(a), ${user.name}!`, 'success');
        if (user.role === 'admin') {
          global.App.navigate('admin');
        } else {
          global.App.navigate('store');
        }
      })
      .catch((err) => {
        Utils.showToast(err.message, 'error');
      })
      .finally(() => setButtonLoading(submitBtn, false));
  }

  // --------------------------------------------------------------------------
  // CADASTRO DE CLIENTE
  // --------------------------------------------------------------------------
  function validateRegisterForm(form) {
    let valid = true;
    const required = ['name', 'phone', 'email', 'password', 'address', 'city', 'state', 'zip'];

    required.forEach((fieldName) => {
      const input = form.elements[fieldName];
      if (!input.value.trim()) {
        showFieldError(input, 'Campo obrigatório.');
        valid = false;
      }
    });

    const email = form.elements.email;
    if (email.value.trim() && !Utils.isValidEmail(email.value.trim())) {
      showFieldError(email, 'Informe um e-mail válido.');
      valid = false;
    }

    const password = form.elements.password;
    if (password.value && password.value.length < 3) {
      showFieldError(password, 'A senha deve ter ao menos 3 caracteres.');
      valid = false;
    }

    return valid;
  }

  function handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    clearFieldErrors(form);

    if (!validateRegisterForm(form)) {
      Utils.showToast('Verifique os campos destacados.', 'warning');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const payload = {
      name: form.elements.name.value,
      cpf: form.elements.cpf.value,
      phone: form.elements.phone.value,
      email: form.elements.email.value,
      password: form.elements.password.value,
      address: form.elements.address.value,
      city: form.elements.city.value,
      state: form.elements.state.value,
      zip: form.elements.zip.value
    };

    setButtonLoading(submitBtn, true, 'Criando conta...');

    DataService.Auth.register(payload)
      .then((user) => DataService.Auth.saveSession(user).then(() => user))
      .then((user) => {
        global.App.setCurrentUser(user);
        form.reset();
        Utils.showToast('Conta criada com sucesso! Você já está logado.', 'success');
        global.App.navigate('store');
      })
      .catch((err) => {
        Utils.showToast(err.message, 'error');
      })
      .finally(() => setButtonLoading(submitBtn, false));
  }

  // --------------------------------------------------------------------------
  // LOGOUT
  // --------------------------------------------------------------------------
  function handleLogout() {
    DataService.Auth.clearSession().then(() => {
      global.App.setCurrentUser(null);
      Utils.showToast('Você saiu da sua conta.', 'info');
      global.App.navigate('login');
    });
  }

  // --------------------------------------------------------------------------
  // Inicialização: liga os formulários e links de navegação entre telas
  // --------------------------------------------------------------------------
  function init() {
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');

    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);

    document.querySelectorAll('[data-action="go-register"]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        global.App.navigate('register');
      })
    );

    document.querySelectorAll('[data-action="go-login"]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        global.App.navigate('login');
      })
    );

    document.querySelectorAll('[data-action="logout"]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout();
      })
    );

    // Máscaras simples nos campos de cadastro
    const cpfInput = document.querySelector('#form-register [name="cpf"]');
    const phoneInput = document.querySelector('#form-register [name="phone"]');
    const cepInput = document.querySelector('#form-register [name="zip"]');
    if (cpfInput) cpfInput.addEventListener('input', (e) => (e.target.value = Utils.maskCpf(e.target.value)));
    if (phoneInput) phoneInput.addEventListener('input', (e) => (e.target.value = Utils.maskPhone(e.target.value)));
    if (cepInput) cepInput.addEventListener('input', (e) => (e.target.value = Utils.maskCep(e.target.value)));
  }

  global.AuthModule = { init };
})(window);
