(() => {
  const $ = (sel, ctx=document) => ctx.querySelector(sel);
  const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

  // Helper: fetch product JSON by handle
  async function fetchProduct(handle){
    const res = await fetch(`/products/${handle}.js`, { credentials: 'same-origin' });
    if(!res.ok) throw new Error('Product not found');
    return res.json();
  }

  // Helper: add to cart
  async function addToCart(variantId, qty=1, properties=null){
    const body = { id: variantId, quantity: qty };
    if (properties) body.properties = properties;
    const res = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    if(!res.ok) throw new Error('Add to cart failed');
    return res.json();
  }

  // Modal controls
  const modal = $('#gg-modal');
  if(!modal) return;

  const media = $('#gg-modal-media');
  const title = $('#gg-modal-title');
  const price = $('#gg-modal-price');
  const desc  = $('#gg-modal-desc');
  const optionsWrap = $('#gg-modal-options');
  const qtyInput = $('#gg-qty');
  const addBtn = $('#gg-add');
  const errorEl = $('#gg-error');
  const closeBtn = $('#gg-close');

  let currentProduct = null;
  let selectedOptions = {};
  let variantMap = {}; // option-title-string -> variant

  function money(cents, currency){
    const amount = (cents / 100).toFixed(2);
    try {
      return new Intl.NumberFormat(undefined, { style:'currency', currency: currency || Shopify.currency.active }).format(amount);
    } catch {
      return `${amount} ${currency || ''}`;
    }
  }

  function openModal(){ modal.setAttribute('open',''); }
  function closeModal(){ modal.removeAttribute('open'); errorEl.classList.add('gg-hidden'); }

  // Show loading state
  function setLoading(loading) {
    if (loading) {
      addBtn.textContent = 'ADDING...';
      addBtn.disabled = true;
    } else {
      addBtn.textContent = 'ADD TO CART';
      addBtn.disabled = false;
    }
  }

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e)=>{ if(e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeModal(); });

  // Build options UI (chips) from product options
  function renderOptions(product){
    optionsWrap.innerHTML = '';
    selectedOptions = {};
    variantMap = {};

    // Precompute variant map
    product.variants.forEach(v => {
      const key = v.options.join(' / ');
      variantMap[key] = v;
    });

    product.options.forEach((opt, idx) => {
      const block = document.createElement('div');
      block.className = 'gg-opt';
      const label = document.createElement('div');
      label.style.fontWeight = '600';
      label.textContent = opt.name;
      block.appendChild(label);

      opt.values.forEach(val => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'gg-chip';
        chip.setAttribute('role','radio');
        chip.setAttribute('aria-checked','false');
        chip.textContent = val;

        chip.addEventListener('click', () => {
          // select value for this option
          selectedOptions[opt.name] = val;
          // update visual state
          $$('.gg-chip', block).forEach(c => c.setAttribute('aria-checked','false'));
          chip.setAttribute('aria-checked','true');
          updateAddState();
        });

        block.appendChild(chip);
      });

      optionsWrap.appendChild(block);
    });
  }

  function getSelectedVariant(product){
    if (!product.options.length) return product.variants.find(v => v.available);
    const keys = product.options.map(o => selectedOptions[o.name] || '');
    if (keys.some(k => !k)) return null;
    const key = keys.join(' / ');
    return variantMap[key] || null;
  }

  function updateAddState(){
    const v = getSelectedVariant(currentProduct);
    if (!v) {
      addBtn.disabled = true;
      price.textContent = money(currentProduct.price, currentProduct.price_currency);
      return;
    }
    addBtn.disabled = !v.available;
    price.textContent = money(v.price, currentProduct.price_currency);
  }

  // Attach click to each product card
  $$('.gg-card').forEach(card => {
    card.addEventListener('click', async () => {
      try{
        const handle = card.dataset.handle;
        if (!handle) {
          console.warn('No product handle found for card');
          return;
        }

        // Show loading state
        setLoading(true);
        
        const product = await fetchProduct(handle);
        currentProduct = product;

        // Media
        const img = (product.media && product.media[0] && product.media[0].src) || (product.images && product.images[0]);
        media.innerHTML = img ? `<img src="${img}" alt="${product.title}">` : '';

        // Title/price/desc
        title.textContent = product.title;
        price.textContent = money(product.price, currentProduct.price_currency);
        desc.textContent = (product.description || '').replace(/<[^>]*>?/gm,'').trim();

        // Options
        renderOptions(product);
        updateAddState();

        // Qty
        qtyInput.value = 1;

        setLoading(false);
        openModal();
      }catch(err){
        console.error(err);
        setLoading(false);
        alert('Could not load product. Please try again.');
      }
    });
  });

  // Add to cart + bonus rule
  addBtn.addEventListener('click', async () => {
    try{
      errorEl.classList.add('gg-hidden');
      setLoading(true);
      
      const qty = Math.max(1, parseInt(qtyInput.value || '1', 10));
      const variant = getSelectedVariant(currentProduct) || currentProduct.variants.find(v => v.available);
      if(!variant) throw new Error('No variant available');

      // Add main product
      await addToCart(variant.id, qty);

      // Conditional bonus auto-add
      const cfgEl = $('#gg-bonus-config');
      if (cfgEl) {
        const triggerColor = cfgEl.dataset.triggerColor?.trim().toLowerCase();
        const triggerSize  = cfgEl.dataset.triggerSize?.trim().toLowerCase();
        const bonusHandle  = cfgEl.dataset.bonusHandle;

        // detect option values for color/size keywords
        const lowerOpts = {};
        currentProduct.options.forEach((o,i)=>{
          const chosen = selectedOptions[o.name] || variant.options[i];
          lowerOpts[o.name.toLowerCase()] = (chosen || '').toLowerCase();
        });

        const values = Object.values(lowerOpts);
        const matches =
          values.includes(triggerColor) &&
          values.includes(triggerSize);

        if (matches && bonusHandle) {
          try{
            const bonusProduct = await fetchProduct(bonusHandle);
            const bonusVariant = bonusProduct.variants.find(v => v.available) || bonusProduct.variants[0];
            if (bonusVariant) {
              await addToCart(bonusVariant.id, 1, { _auto_added: 'Gift Guide rule' });
              console.log('Bonus product added:', bonusProduct.title);
            }
          }catch(e){ 
            console.warn('Bonus add failed', e); 
          }
        }
      }

      setLoading(false);
      // Close and navigate to cart (or show a mini feedback)
      closeModal();
      window.location.href = '/cart';
    }catch(err){
      console.error(err);
      setLoading(false);
      errorEl.textContent = 'Sorry, we could not add this to your cart. Please try again.';
      errorEl.classList.remove('gg-hidden');
    }
  });

})();
