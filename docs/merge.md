# Guía de revisión y merge — laboratorios OT/ICS

**PR:** [#1 — Cuatro laboratorios OT con captura real y consola SCADA empresarial](https://github.com/vtomasv/ot-ics-labs-modbus-opcua-dnp3/pull/1) · **base:** `main` · **head:** `feat/interactive-ot-lab-workspaces`. Esta guía prepara la decisión de fusión; **no declara que la PR esté fusionada** ni sustituye la revisión del titular.

## Alcance que se integrará

1. Cuatro pantallas independientes (`01-baseline`, `02-modbus`, `03-opcua`, `04-dnp3`) con pasos, criterios, matriz MITRE ATT&CK for ICS, referencias IEC 62443, topología lógica, telemetría y gemelo 3D.
2. Servicios Docker aislados que realmente intercambian Modbus/TCP 502, OPC UA 4840 y DNP3/TCP 20000. Sensor PCAP pasivo y Suricata separados; **solo HTTP en `127.0.0.1:8080`** sale del Compose normal.
3. Inyección **limitada** a la maqueta: Modbus FC03/FC06 y setpoint 30–95, OPC UA Write/Read 30–95, DNP3 salida 0/1/2. No hay destinos arbitrarios, MITM transparente ni exploit para terceros.
4. Interfaz clara y bomba centrífuga procedural con cámara de inspección. El modelo de tanque, actuadores, interlock y semáforo es **software didáctico**; no hay hardware, curva hidráulica calibrada o SIS certificado.
5. Recuperación de una **lectura DNP3 sin respuesta después de un Direct Operate confirmado**: se abre una nueva conexión de **solo lectura** y se exige readback antes de declarar éxito. No se retransmite el comando de control. Un readback que tampoco se verifica sigue siendo **fallo**, aunque el outstation pudiera haber aplicado la orden: inspeccionar estado y PCAP antes de volver a actuar.
6. [Trece capturas nuevas verificadas](capturas/README.md), incluidas las dos antiguas `consola-*.png` rehechas y cuatro páginas completas con efectos, paquetes, monitor, pasos y MITRE. Su [`manifest.json`](capturas/manifest.json) fija el SHA-256 de cada PNG y el commit del código usado para capturar.

## Criterios de aceptación previos al merge

| Puerta | Cómo comprobarla | Resultado esperado |
|---|---|---|
| Conflictos y estado de PR | `gh pr view 1 --json mergeable,mergeStateStatus,isDraft,reviewDecision,headRefOid` | `MERGEABLE`, `CLEAN`, no draft; atender cualquier revisión requerida. Consultar nuevamente después del último push. |
| CI para **el HEAD final** | `gh pr checks 1` | Jobs `lab (ubuntu-24.04)` y `lab (ubuntu-24.04-arm)` verdes. ARM es **amd64 emulado con QEMU**, no validación nativa ARM. |
| Integración de las cuatro prácticas | `python3 scripts/verify-workspaces.py` | `PASS TODOS LOS WORKSPACES`, FC03, FC06, OPC UA, DNP3, PCAP y reset estable. En el proyecto de capturas: `LAB_VERIFY_PORT=18080 python3 scripts/verify-workspaces.py`. |
| Escenarios heredados e IDS | `bash scripts/verify-lab.sh` | `PASS TODOS LOS ESCENARIOS`, firma Suricata FC06 y bytes de proxy comparados. |
| Pruebas y seguridad DNP3 | `docker compose exec -T plant python -m unittest discover -s app/tests -v` y `docker compose exec -T trainer python /lab/dnp3/test_native_unit.py` | 8 pruebas del gemelo/sensor y test de recuperación de readback sin repetir Direct Operate. |
| Integridad y revisión visual | [Comando de hash y galería](capturas/README.md) | 13/13 SHA-256 correctos; revisar al 100 % al menos [Modbus](capturas/02-modbus-completo.png), [OPC UA](capturas/03-opcua-completo.png), [DNP3](capturas/04-dnp3-completo.png), [línea base](capturas/01-baseline-completo.png) y la vista móvil. |
| Texto y alcance científico | [README](../README.md), [validación](validacion.md), guías en [`docs/labs/`](labs/) | No afirmar intercepción de terceros, detección de servicios OPC UA/DNP3 que solo son firmas de presencia, ni cumplimiento normativo por ejecutar la maqueta. |

**Resultado local de preparación (27-sep-2026):** pila aislada `ot-ics-capturas-v4` en loopback 18080: capturador `13/13`, `verify-workspaces.py` **PASS**, 8/8 pruebas unitarias **PASS** y prueba de readback DNP3 **PASS**. La PR y la CI **deben verificarse de nuevo después de publicar el commit de documentación/capturas**; una ejecución verde anterior no valida el HEAD nuevo. Los servicios y volúmenes de capturas no forman parte del despliegue de producción.

## Procedimiento de revisión y decisión

1. Inspeccione el [diff del PR](https://github.com/vtomasv/ot-ics-labs-modbus-opcua-dnp3/pull/1/files) y la [galería](capturas/README.md). Compare el estado del gemelo con el PCAP y con firmas IDS: son **fuentes distintas**, no pruebas de un PLC físico.
2. Compruebe la lista anterior contra el **último** commit y la CI final. Ejecute el laboratorio con `docker compose up -d --build` en un anfitrión autorizado; abra `http://127.0.0.1:8080/labs/01-baseline`. Use *Restablecer* entre prácticas; no elimina eventos ni PCAP.
3. Registre explícitamente los riesgos aceptados: `dnp3-python==0.3.0b1` está *yanked* y la imagen fija amd64; el modo OPC UA `NoSecurity`, credenciales de ejemplo y reglas IDS simplificadas son **vulnerabilidades intencionadas de aula**; el sensor mira un conducto privado, no toda la red; el control DNP3 no usa Secure Authentication. Consulte [diagnóstico](diagnostico.md) para limitaciones del sandbox y otras plataformas.
4. **Licencia:** el código original del repositorio todavía no tiene licencia publicada. Fusionar cambios en el repositorio del titular no otorga por sí mismo permiso de reutilización a terceros; el titular debe decidir la licencia antes de promover redistribución externa. La licencia MIT de Three.js vendorizado se conserva separadamente.
5. Una vez aceptados los puntos anteriores y con la CI final verde, la acción de fusión recomendada, **a cargo del titular o de quien tenga autorización explícita**, es `gh pr merge 1 --squash`. No borra la rama automáticamente ni descarta volúmenes locales. Si la organización requiere otra estrategia o aprobación, respétela.

## Reversión y conservación de evidencias

Para detener el laboratorio sin perder pruebas: `docker compose down` (**no** `-v`). Si se requiere revertir un squash merge, cree una rama desde `main`, ejecute `git revert <SHA-del-commit-squash>` y abra un PR de reversión; no utilice `reset --hard` sobre la rama compartida. El revert de código no elimina PCAP, logs ni eventos conservados en los volúmenes: su retención o borrado necesita una decisión **separada** del responsable de la evidencia. Los comandos controlados solo están autorizados dentro de esta maqueta Docker local.
