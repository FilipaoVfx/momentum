-- Ventana de 48 h para el eje de fundamento.
--
-- DefiLlama publica agregados diarios con retraso variable: un día trae TVL y
-- comisiones, y al siguiente solo TVL. Con ventana de 24 h la **base** del
-- compuesto cambiaba de un día para otro, y la serie salía en diente de sierra:
-- el salto no era el fundamento moviéndose, era el compuesto midiendo otra cosa.
--
-- 48 h garantiza que la cifra diaria más reciente de cada componente esté en la
-- ventana. El valor sigue siendo real y citando su snapshot; lo único que
-- cambia es cuánto miramos hacia atrás para encontrarlo.

-- +migrate up

alter table metric_point drop constraint metric_point_window_label_check;
alter table metric_point add constraint metric_point_window_label_check
  check (window_label in ('1h', '24h', '48h', '7d'));

-- +migrate down

delete from metric_point where window_label = '48h';
alter table metric_point drop constraint metric_point_window_label_check;
alter table metric_point add constraint metric_point_window_label_check
  check (window_label in ('1h', '24h', '7d'));
