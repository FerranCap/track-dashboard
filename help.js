'use strict';

const HELP_SCOPE = ' Se calcula con las operaciones que cumplen los filtros actuales; en tablas y gráficos, solo con las del grupo indicado.';
const HELP_RR = 'RR realizado = ganancia media de las operaciones ganadoras ÷ valor absoluto de la pérdida media de las perdedoras. La «x» significa «veces»: 0,57x equivale a ganar de media $0,57 por cada $1 perdido de media; por ejemplo, $57 ÷ $100 = 0,57x. No es un porcentaje ni el riesgo planificado de cada trade. Requiere al menos una ganadora y una perdedora.';
const HELP_WINRATE = 'Win rate = operaciones con PnL positivo ÷ total de operaciones × 100. Las operaciones a cero cuentan en el total. Por ejemplo, 6 ganadoras de 10 operaciones = 60%.';
const HELP_PNL = 'PnL = suma del TradePnL de cada operación cerrada, agrupada por QuantTradeId. Se expresa en dólares (USD), con el signo del resultado. Se usa el PnL del CSV; las comisiones no se restan otra vez.';
const HELP_EQUITY = 'Curva de capital = suma acumulada del PnL de las operaciones cerradas en orden de cierre, empezando en $0. Representa el beneficio acumulado, no el saldo de la cuenta ni una rentabilidad porcentual.';
const HELP_DRAWDOWN = 'Drawdown = máximo de PnL acumulado alcanzado hasta ese momento − PnL acumulado actual. El gráfico lo dibuja en negativo: −$100 significa estar $100 por debajo del máximo anterior. El máximo inicial es $0.';

function helpKey(label) {
  return String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function helpText(label) {
  const key = helpKey(label);
  const rules = [
    [/tickers identificados/, 'Tickers distintos del historial que tienen país de constitución identificado. La ausencia de jurisdicción detallada, país de operación, sede, ADR o VIE no cambia esta clasificación.'],
    [/tickers sin identificar/, 'Tickers distintos del historial sin país de constitución identificado. Este es el único dato que determina Sin identificar y Sin clasificar en los estudios por país.'],
    [/variacion pnl absoluto medio/, 'Media de |PnL| del mes actual menos la media de |PnL| del anterior mes observado, en USD. No utiliza precio ni shares. Puede aumentar tanto por mayores ganancias como por mayores pérdidas.'],
    [/pnl absoluto medio/, 'Media aritmética de |PnL|, tomando primero el valor absoluto de cada trade. +$10 y −$6 dan ($10 + $6) ÷ 2 = $8. Incluye los trades a cero y los costes ya incluidos en PnL. No se divide por precio ni por shares.'],
    [/pnl absoluto mediano/, 'Mediana de |PnL| de cada trade en dólares. Se aplica primero el valor absoluto por operación y luego se calcula el percentil 50. No utiliza precio ni shares.'],
    [/pnl medio por trade/, 'Suma del PnL de los trades ÷ número de operaciones, manteniendo el signo. +$10 y −$6 dan +$2 de media. Incluye los trades a cero y no utiliza precio ni shares.'],
    [/variacion del beneficio/, 'PnL del mes actual menos PnL del anterior mes observado dentro de los filtros, en USD. No es variación del saldo ni rentabilidad porcentual; el primer mes no tiene comparación.'],
    [/variacion del tamano/, '(Media de acciones de entrada del mes actual ÷ media del anterior mes observado − 1) × 100. Solo se calcula con medias válidas en ambos meses. Más acciones no implica necesariamente más riesgo ni más capital.'],
    [/tamano medio/, 'Media aritmética de las cantidades de entrada conocidas y positivas de las operaciones cerradas en el período. Se expresa en acciones; excluye cantidades ausentes y no mide riesgo monetario.'],
    [/tamano mediano/, 'Mediana de las cantidades de entrada conocidas y positivas del período. Es el percentil 50, interpolado si procede; se expresa en acciones y no mide riesgo monetario.'],
    [/cantidad disponible/, 'Número de operaciones con cantidad de entrada conocida y positiva frente al total de operaciones del mes. Solo las cantidades válidas entran en la media y la mediana.'],
    [/beneficio acumulado/, 'Suma del PnL de las operaciones filtradas desde un inicio de $0 hasta el mes indicado. No incluye saldo inicial, ingresos ni retiradas y no representa rentabilidad porcentual.'],
    [/ventanas positivas/, 'Ventanas completas cuyo PnL total es positivo ÷ total de ventanas completas × 100. Se solapan; no son observaciones independientes.'],
    [/^ventana$/, 'Número de operaciones cerradas consecutivas utilizadas para cada cálculo móvil. La fila resume la última ventana completa.'],
    [/ganadoras excluidas/, 'Número real de operaciones ganadoras retiradas, hasta el límite del escenario. Si faltan ganadoras, se excluyen las disponibles.'],
    [/ganancias positivas concentradas/, 'PnL de las ganadoras excluidas ÷ suma del PnL de todas las operaciones ganadoras × 100. El denominador son ganancias brutas positivas, no el beneficio neto.'],
    [/peso en beneficios de grupos/, 'Máximo entre PnL del grupo y cero ÷ suma de los PnL positivos de todos los grupos × 100. Un grupo negativo pesa cero; cambia al cambiar la agrupación.'],
    [/pnl sin este grupo/, 'PnL total de las operaciones filtradas menos el PnL del grupo de esta fila. No se modifica el historial original.'],
    [/pnl restante|profit factor restante/, 'La métrica se recalcula excluyendo las mejores operaciones ganadoras del escenario. Profit factor = ganancias restantes ÷ pérdidas absolutas restantes; no es una previsión.'],
    [/maximo desde/, 'Fecha del último máximo de la curva antes del episodio de drawdown. El primer punto de referencia es $0 al inicio del historial filtrado.'],
    [/recuperacion \/ ultimo dato/, 'Fecha en que la curva vuelve a alcanzar el máximo previo, o fecha del último trade disponible si el episodio sigue abierto.'],
    [/operaciones hasta recuperacion/, 'Número de cierres desde el último máximo hasta recuperarlo, incluida la operación de recuperación. En un episodio abierto cuenta los cierres transcurridos.'],
    [/dias naturales/, 'Diferencia entre las fechas de cierre en Nueva York del último máximo y de la recuperación o último dato. Incluye días sin operaciones y puede ser cero si se recupera el mismo día.'],
    [/^estado$/, 'Recuperado significa que se volvió al máximo previo. Abierto significa que el máximo aún no se ha recuperado al final del historial filtrado.'],
    [/contexto al abrir/, 'Resultado del último trade que ya había cerrado cuando se abrió esta operación, considerando únicamente el historial filtrado. No usa cierres futuros ni implica causalidad.'],
    [/shares medios/, 'Media aritmética de las acciones de entrada conocidas y positivas. Los datos ausentes no se convierten en cero. No equivale a riesgo monetario ni permite comparar exposición entre precios diferentes.'],
    [/espera mediana/, 'Mediana de los minutos entre el último cierre conocido y la siguiente apertura. Incluye noches y fines de semana. Una espera menor puede indicar mayor frecuencia, sin demostrar una causa.'],
    [/resultado simulado|escenarios con pnl/, 'Distribución de 500 escenarios por remuestreo con reemplazo de sesiones históricas. El porcentaje negativo cuenta escenarios con PnL final menor que cero; es una frecuencia simulada, no una probabilidad futura garantizada.'],
    [/^p5$|^p95$|mediana.*p50/, 'Percentiles 5, 50 y 95 de los escenarios. La mediana divide la muestra en dos mitades. En el gráfico son percentiles separados en cada paso; no son trayectorias individuales ni intervalos de confianza.'],
    [/racha perdedora maxima/, 'Máxima cantidad de trades negativos consecutivos en cada escenario; un trade a cero interrumpe la racha. Los percentiles de esta cantidad pueden interpolarse y tener decimales.'],
    [/^escenario$/, 'Comparación histórica al excluir las mejores operaciones ganadoras, sin alterar el registro original.'],
    [/tickers del historial/, 'Número de símbolos distintos en todo el historial publicado. Esta comprobación no aplica los filtros de análisis.'],
    [/tickers sin ficha/, 'Tickers del historial que no tienen una fila en la base de emisores. Se incluyen como nuevos pendientes, aunque tengan varias operaciones.'],
    [/constitucion incompleta/, 'Tickers sin país o sin jurisdicción de constitución en su ficha, incluidos los que aún no tienen ficha. Se comprueba todo el historial.'],
    [/operacion sin confirmar/, 'Tickers sin país de operación documentado. Un país solo inferido por instalaciones continúa pendiente; se exige una declaración en el documento o una revisión documentada.'],
    [/datos pendientes/, 'Campos aún ausentes o sin confirmar en la ficha del emisor. Detectarlos no los completa automáticamente ni convierte una inferencia en un dato confirmado.'],
    [/^ticker$/, 'Símbolo único que aparece en el historial de operaciones publicado. La lista de Tickers cuenta cada ticker una vez.'],
    [/constitucion|jurisdiccion/, 'País y jurisdicción societaria de la entidad cotizada, según la ficha SEC o la portada del documento. Se conserva separada del país de operación. La empresa también puede estar sometida a normativa de otros países.'],
    [/\bvie\b/, 'Una VIE es una entidad de interés variable consolidada o vinculada mediante acuerdos específicos. «Sí» o «No» requieren una declaración identificada en el documento; «Sin confirmar» no significa ausencia. Una VIE contable no implica por sí misma exposición a China.'],
    [/valor cotizado|\badr\b|\bads\b/, 'Distingue acciones ordinarias/directas de American Depositary Shares o Receipts. La condición ADS/ADR y la existencia de una VIE son atributos independientes.'],
    [/emisor/, 'Entidad legal identificada por el CIK de la SEC. Se muestra el nombre del registro al investigar; puede diferir del nombre usado cuando operaste el ticker.'],
    [/fuentes/, 'Enlaces a la ficha oficial del emisor y al documento de la SEC utilizado, con fecha de publicación y fecha de consulta. Una instantánea actual no reconstruye automáticamente cambios históricos.'],
    [/risk\/reward planificado/, 'Risk/Reward planificado = distancia entre entrada y objetivo ÷ distancia entre entrada y stop inicial. No está disponible porque los CSV actuales no incluyen el stop ni el objetivo iniciales.'],
    [/acierto sin|tu acierto sin/, 'Acierto sin operaciones a cero = ganadoras ÷ (ganadoras + perdedoras) × 100. Las operaciones a cero se excluyen de este denominador.'],
    [/acierto de equilibrio/, 'Acierto de equilibrio = 1 ÷ (1 + relación ganancia media/pérdida media) × 100. Es el acierto necesario para igualar ganancias y pérdidas con esa relación, excluyendo operaciones a cero.'],
    [/margen/, 'Margen = acierto observado sin operaciones a cero − acierto de equilibrio. La unidad pp significa puntos porcentuales: 60% − 50% = 10 pp.'],
    [/win\/loss ratio/, 'Win/Loss Ratio = número de operaciones ganadoras ÷ número de operaciones perdedoras. Mide frecuencias, no el tamaño de sus ganancias o pérdidas.'],
    [/wins \/ losses|ganadoras \/ perdedoras/, 'Número de operaciones ganadoras y perdedoras, respectivamente. Una operación es ganadora si su PnL > $0,000001 y perdedora si su PnL < −$0,000001; entre ambos límites se considera a cero.'],
    [/\brr\b|ganancia \/ perdida|ganancia media \/ perdida|beneficio \/ perdida/, HELP_RR],
    [/win rate|winrate/, HELP_WINRATE],
    [/profit factor/, 'Profit factor = suma del PnL de las ganadoras ÷ valor absoluto de la suma del PnL de las perdedoras. 1,40 significa $1,40 de ganancias totales por cada $1 de pérdidas totales. ∞ indica ganancias sin pérdidas; — indica que no hay resultado para calcularlo.'],
    [/ganancia media|avg win/, 'Ganancia media = suma del PnL de las operaciones ganadoras ÷ número de ganadoras, en USD. No incluye perdedoras ni operaciones a cero.'],
    [/perdida media|avg loss/, 'Pérdida media = suma del PnL de las operaciones perdedoras ÷ número de perdedoras, en USD. Se muestra negativa; para calcular el RR se usa su valor absoluto.'],
    [/esperanza|pnl medio \/ operacion|pnl medio \/ trade|pnl medio$|avg trade/, 'Esperanza realizada por operación = PnL total ÷ número de operaciones, incluidas las operaciones a cero. Se expresa en USD por operación; describe la muestra histórica.'],
    [/pnl medio \/ accion|per-share/, 'PnL medio por acción = PnL total ÷ suma de las cantidades de entrada. Se expresa en USD por acción; no es una media simple de los precios.'],
    [/pnl medio \/ dia|avg daily p/, 'PnL medio por día = PnL total ÷ número de fechas de cierre distintas con operaciones. No incluye días sin operaciones.'],
    [/operaciones \/ dia|avg daily volume/, 'Operaciones por día = número de operaciones cerradas ÷ número de días operados distintos. No incluye días sin operaciones.'],
    [/duracion|avg hold/, 'Duración = máximo entre 0 y (hora de cierre − hora de apertura), en minutos. La media se calcula solo con duraciones disponibles del grupo indicado: ganadoras, perdedoras o a cero.'],
    [/sqn/, 'SQN = raíz cuadrada del número de operaciones × PnL medio por operación ÷ desviación estándar muestral del PnL por operación. No se calcula si la desviación es cero. Depende del tamaño y distribución de la muestra.'],
    [/k-ratio/, 'K-Ratio = pendiente de una regresión lineal del PnL acumulado por número de operación ÷ error estándar estimado de esa pendiente. Requiere al menos 4 operaciones y error estándar distinto de cero.'],
    [/kelly/, 'Kelly (%) = [p − (1 − p) ÷ b] × 100, con p = ganadoras/total y b = ganancia media/pérdida media absoluta. Esta implementación incluye operaciones a cero en el total de p. Es una estimación histórica, no una recomendación de tamaño de posición.'],
    [/std deviation/, 'Desviación estándar muestral del PnL por operación = raíz de [suma de (PnL individual − PnL medio)² ÷ (n − 1)]. Se expresa en USD y mide dispersión; con menos de 2 operaciones se muestra 0.'],
    [/random chance/, 'Valor p de una prueba binomial bilateral que compara ganadoras y perdedoras bajo una probabilidad de acierto del 50%. Excluye operaciones a cero. No es la probabilidad de que tu estrategia sea aleatoria y no estudia el tamaño de ganancias y pérdidas.'],
    [/mae|mfe/, 'MAE mide la máxima excursión adversa y MFE la máxima excursión favorable durante una operación. Requieren el recorrido de precios mientras estuvo abierta; no están disponibles con los CSV actuales.'],
    [/avg trades in drawdown/, 'Media del número de cierres con drawdown positivo en cada período de drawdown. Incluye el período actual aunque aún no se haya recuperado.'],
    [/avg dias en drawdown/, 'Media del número de fechas de cierre distintas con drawdown positivo por período. Incluye el período actual aunque no esté recuperado; no mide días naturales transcurridos.'],
    [/dias en drawdown/, 'Número de fechas de cierre distintas en las que al menos una operación cerró por debajo del máximo previo de PnL acumulado.'],
    [/periodos drawdown/, 'Número de episodios que comienzan al cerrar una operación por debajo del máximo acumulado y terminan cuando un cierre recupera ese máximo. Incluye el episodio abierto, si existe.'],
    [/average drawdown/, 'Drawdown medio = media de las distancias al máximo acumulado solo en los cierres con drawdown positivo. No es la media de los máximos de cada episodio.'],
    [/biggest drawdown|drawdown maximo/, 'Drawdown máximo = mayor distancia entre el máximo previo de PnL acumulado y el PnL acumulado en un cierre. Se muestra como importe positivo en la tarjeta.'],
    [/drawdown/, HELP_DRAWDOWN],
    [/max racha|max consec/, 'Mayor número de operaciones consecutivas del resultado indicado: ganadoras o perdedoras. Una operación a cero interrumpe la racha.'],
    [/rachas/, 'Número de secuencias consecutivas de operaciones del resultado indicado y media de operaciones por secuencia. Las operaciones a cero interrumpen las rachas.'],
    [/mejor operacion|largest gain|best day/, 'Mayor PnL observado: de una operación en «Mejor operación», o de la suma diaria en «Best Day». Se calcula dentro del conjunto seleccionado.'],
    [/peor operacion|largest loss|worst day/, 'Menor PnL observado: de una operación en «Peor operación», o de la suma diaria en «Worst Day». Se calcula dentro del conjunto seleccionado.'],
    [/comisiones|total fees/, 'Suma de las comisiones de ejecuciones únicas asociadas a las operaciones. Las ejecuciones repetidas entre exportaciones se deduplican. No se descuentan de nuevo del PnL del CSV.'],
    [/volumen de entrada|shares/, 'Suma de cantidades de las ejecuciones de entrada, en acciones. Para cada trade se consideran entradas las ejecuciones cuyo lado coincide con la dirección de apertura.'],
    [/entrada|entry/, 'Precio de entrada = suma de (precio × cantidad) de las ejecuciones de entrada ÷ suma de sus cantidades. Es un precio medio ponderado, en USD.'],
    [/dias operados|trading days/, 'Número de fechas de cierre distintas con al menos una operación. Las fechas se expresan en la zona horaria de Nueva York.'],
    [/cobertura/, 'Cobertura = operaciones con país identificado ÷ total de operaciones × 100. Los símbolos sin país siguen incluidos como «Sin clasificar».'],
    [/paises identificados/, 'Número de países de constitución distintos entre las operaciones filtradas. Solo se usa el país registrado en la ficha del emisor; no se deduce de la bolsa, sede ni país de operación.'],
    [/sin clasificar/, 'Operaciones de tickers sin país de constitución identificado. La ausencia de país de operación, jurisdicción detallada o VIE no las deja sin clasificar.'],
    [/simbolos/, 'Número de símbolos distintos entre las operaciones seleccionadas.'],
    [/ganadoras|winning trades/, 'Número de operaciones con PnL mayor que $0,000001. Si aparece un porcentaje, se divide este número por el total de operaciones.'],
    [/perdedoras|losing trades/, 'Número de operaciones con PnL menor que −$0,000001. Si aparece un porcentaje, se divide este número por el total de operaciones.'],
    [/a cero|scratch/, 'Número de operaciones con PnL entre −$0,000001 y $0,000001, ambos incluidos. Cuentan en el total de operaciones y en el denominador del win rate general.'],
    [/muestra/, 'Número de operaciones utilizadas en el grupo. «Reducida (<20)» es un aviso descriptivo de tamaño de muestra; 20 operaciones no garantizan fiabilidad estadística.'],
    [/pnl/, HELP_PNL],
    [/operaciones|trades/, 'Número de operaciones cerradas únicas, una por QuantTradeId. Varias ejecuciones de una misma operación no cuentan como operaciones distintas.'],
    [/apertura|cierre|fecha/, 'Fecha u hora del evento indicado, convertida a America/New_York y con el cambio de horario estacional correspondiente. El día de una operación es el de su cierre.'],
    [/direccion/, 'Long corresponde a TradeSide BUY y Short a TradeSide SELL. Cada grupo conserva las operaciones de esa dirección.'],
    [/pais/, 'Los estudios por país se agrupan exclusivamente por país de constitución de la entidad cotizada. Operación, sede, jurisdicción detallada, tipo de valor y VIE se conservan como información adicional en Tickers y no afectan a la identificación ni a los resultados por país.'],
    [/grupo|rango|dia|simbolo/, 'Criterio que agrupa las operaciones de esta fila. Las demás columnas se calculan únicamente con las operaciones del grupo y los filtros seleccionados.']
  ];
  const scope = /^(tickers del historial|tickers identificados|tickers sin identificar|tickers sin ficha|constitucion incompleta|operacion sin confirmar|datos pendientes|ticker)$/.test(key) ? ' Se comprueba todo el historial publicado, sin filtros de análisis.' : HELP_SCOPE;
  return (rules.find(([pattern]) => pattern.test(key))?.[1] || 'Dato del conjunto de operaciones seleccionado. «—» o «N/D» indican que faltan datos o que el cálculo no está definido.') + scope;
}

function helpAttributes(text) {
  return `data-help="${esc(text)}"`;
}

function chartHelp(id, opts) {
  if (opts.unit === 'x') return HELP_RR + HELP_SCOPE;
  if (opts.unit === '%') return HELP_WINRATE + ' Cada barra corresponde al grupo del eje horizontal.' + HELP_SCOPE;
  if (id.includes('drawdown')) return HELP_DRAWDOWN + HELP_SCOPE;
  if (id.includes('equity') || id.includes('comparison') || id === 'compare-chart') return HELP_EQUITY + ' Cada serie usa sus operaciones; las comparativas alinean el PnL acumulado por fecha.' + HELP_SCOPE;
  const group = id.includes('time') ? 'la franja de 5 minutos de la hora de entrada en Nueva York' : id.includes('price') ? 'el rango del precio medio ponderado de entrada' : id.includes('weekday') ? 'el día de la semana de cierre en Nueva York' : id.includes('month') ? 'el mes de cierre en Nueva York' : id.includes('symbol') ? 'el símbolo (se muestran los 12 más operados)' : id.includes('country') ? 'el país de la empresa emisora; lo desconocido queda sin clasificar' : 'la fecha de cierre en Nueva York';
  return `${HELP_PNL} Cada barra suma las operaciones agrupadas por ${group}.` + HELP_SCOPE;
}

function initializeHelp() {
  const tooltip = $('data-tooltip');
  let active = null;
  let touchTarget = null;
  let hideTimer = null;
  function hide() {
    clearTimeout(hideTimer);
    if (active) {
      if (active.helpPreviousDescription) active.setAttribute('aria-describedby', active.helpPreviousDescription);
      else active.removeAttribute('aria-describedby');
    }
    tooltip.hidden = true;
    active = null;
  }
  function position(x, y) {
    const margin = 12;
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    const left = Math.max(margin, Math.min(x + 16, window.innerWidth - width - margin));
    const top = y + 18 + height < window.innerHeight - margin ? y + 18 : Math.max(margin, y - height - 14);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function show(target, event) {
    clearTimeout(hideTimer);
    if (active !== target) {
      hide(); active = target;
      target.helpPreviousDescription = target.getAttribute('aria-describedby');
      target.setAttribute('aria-describedby', [target.helpPreviousDescription, tooltip.id].filter(Boolean).join(' '));
    }
    tooltip.textContent = target.dataset.help;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    position(event?.clientX ?? rect.left, event?.clientY ?? rect.bottom);
  }
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    if (tooltip.contains(event.target)) { clearTimeout(hideTimer); return; }
    const target = event.target.closest('[data-help]');
    if (target) show(target, event); else hide();
  });
  document.addEventListener('pointermove', event => {
    if (active && event.pointerType !== 'touch' && !tooltip.contains(event.target)) position(event.clientX, event.clientY);
  });
  document.addEventListener('pointerout', event => {
    if (active && !active.contains(event.relatedTarget) && !tooltip.contains(event.relatedTarget)) hideTimer = setTimeout(hide, 150);
  });
  document.addEventListener('focusin', event => {
    const target = event.target.closest('[data-help]');
    if (target) show(target); else hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('change', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { hide(); touchTarget = null; } });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    const target = event.target.closest('[data-help]');
    if (!target || target === touchTarget) { hide(); touchTarget = null; }
    else { touchTarget = target; show(target, event); }
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('hashchange', hide);
  document.addEventListener('visibilitychange', hide);
  const controls = {
    'ratio-time-interval': 'Agrupa por hora de entrada en Nueva York, en franjas de 5 minutos por defecto; también puedes elegir 30 o 60 minutos. El inicio está incluido y el final excluido: 09:30–09:35 incluye 09:30, pero no 09:35.',
    'ratio-min-trades': 'Muestra únicamente los grupos con al menos este número de operaciones. Se aplica al estudio por horario y al estudio por país.',
    'calendar-month': 'Selecciona el mes de las fechas de cierre. Cada día muestra la suma del PnL y el número de operaciones cerradas ese día.',
    'growth-trade-window': 'Muestra las últimas 50, 100 o 250 operaciones, o todas las que cumplen los filtros generales. Cada barra usa |PnL final| de un único trade; no agrega ni promedia. La selección solo cambia este gráfico y se puede desplazar horizontalmente.',
    'calendar-overview-prev': 'Muestra el bloque anterior de seis meses en el panel lateral. Conserva el día seleccionado; pulsa un día con operaciones para abrir su resumen.',
    'calendar-overview-next': 'Muestra el bloque siguiente de seis meses en el panel lateral. Los colores y totales usan los filtros generales y las fechas de cierre en Nueva York.',
    'issuer-search': 'Busca un ticker o nombre de emisor en todo el historial publicado. Las fichas de Tickers no se limitan por los filtros de análisis.',
    'consistency-window': 'Selecciona 25, 50 o 100 operaciones para los gráficos móviles de PnL medio y win rate. La tabla conserva las tres ventanas. Cada punto usa cierres consecutivos y requiere la ventana completa.',
    'consistency-concentration': 'Agrupa por ticker, país de constitución, franja de entrada de 5 minutos en Nueva York o día de cierre. El peso se calcula sobre la suma de beneficios positivos de los grupos; las pérdidas no se usan como denominador.',
    'consistency-horizon': 'Número de operaciones de cada uno de los 500 escenarios. Se sortean sesiones históricas con reemplazo, conservando el orden de sus trades y recortando el último bloque. La misma selección produce resultados repetibles. No es una previsión ni una rentabilidad sobre capital.',
    'country-check-pending': 'Recarga los últimos datos publicados, compara todos sus tickers con la base de emisores y abre la lista de pendientes en Tickers. Conserva los filtros de análisis.',
    'data-check-pending': 'Actualiza los datos publicados y repite la comprobación de todos los tickers del historial. No investiga ni asigna países automáticamente.',
    'data-pending-search': 'Busca un ticker o nombre de empresa en los pendientes de todo el historial, sin aplicar los filtros globales de análisis.',
    'data-pending-kind': 'Muestra tickers sin país de constitución o solo aquellos sin ficha. Otros campos incompletos se conservan en la base de emisores y no cuentan como tickers sin identificar.',
    'best-from': 'Inicio inclusivo del rango de fechas de cierre para buscar la mejor y peor operación; respeta los filtros globales.',
    'best-to': 'Final inclusivo del rango de fechas de cierre para buscar la mejor y peor operación; respeta los filtros globales.',
    search: 'Busca símbolos dentro de las operaciones que cumplen los filtros globales.'
  };
  for (const [id, text] of Object.entries(controls)) $(id).setAttribute('data-help', text);
  const filterHelp = {
    period: 'Selecciona todo el historial, un a?o, un mes o un rango personalizado de fechas de cierre en Nueva York.',
    from: 'Incluye operaciones cerradas desde esta fecha, inclusive. Cada grupo usa sus propios filtros.',
    to: 'Incluye operaciones cerradas hasta esta fecha, inclusive. Cada grupo usa sus propios filtros.',
    symbol: 'Escribe el ticker completo. Se aceptan mayúsculas o minúsculas. Deja el campo vacío para incluir todos.',
    side: 'Filtra por direcci?n: todas, Long (BUY) o Short (SELL).'
  };
  document.querySelectorAll('.trade-filter-panel [data-field]').forEach(control => control.setAttribute('data-help', filterHelp[control.dataset.field]));
  document.querySelectorAll('th').forEach(header => {
    header.setAttribute('data-help', helpText(header.textContent)); header.tabIndex = 0;
  });
}
