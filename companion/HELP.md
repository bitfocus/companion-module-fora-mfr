Version 3.0.0 is built against and tested on Companion 5.1.2. Earlier versions of Companion have not been tested. It has only been tested with an MFR-3000 router.

## SETUP

In the router's web interface (System Settings > Router System Settings > Port Settings):

- In the TCP/IP section set "Default Function" to "Crosspoint remote control 2"
- In the Command Response section make sure that Echo, C and S responses are checked
- Send changes in order to save them to the system

The module sends one command at a time and waits for the router's prompt before sending the next, as the router requires. If no prompt arrives it moves on after 1 second, or 5 seconds for commands with long replies.

## HOW IT WORKS

Select a destination and a source, in either order, then press a cut or stage button. The pair stays selected until you cut. A steady green source is the one routed to the selected destination now; a flashing one is the next source, which a cut or stage would route.

To build a salvo (a soft macro) of several routes: select a source, then a destination, and press STAGE; the pair stays on show, and each further destination you press and STAGE is added with the same source. Pressing a source starts a new pair. Set "When a destination and a source are both selected" to "Stage straight away" in the connection settings to drop the STAGE press entirely. Destinations showing a staged route show the staged source on their own line and turn orange. The salvo switch button flashes while routes are staged: press it to take them all at once, or clear staged to discard them. The module learns the router's size, port names, crosspoints, staged routes and destination locks on connect, and re-reads the crosspoints, staged routes and port names every few seconds (see the refresh setting) so changes made elsewhere show up. If a command gets no reply for 6 seconds the module reconnects, and keeps trying every 5 seconds until the router returns. Staged routes belong to a connection, so a reconnect loses them. A cut to a locked destination is refused: the module logs a warning and keeps the selection and any staged route. Staged routes belong to the connection that made them: routes staged from a panel or another client are not visible to this module, and it can only take or clear its own. The router's manual calls a staged route a "preset crosspoint".

The router's lowest level that responds to a system size request is the one controlled.

## LOG

The connection's log shows what the module found on connecting, reconnects, the auto-route mode, and routes and names changed from elsewhere. At debug level it also shows each operator command, any command that got no prompt, and any line from the router it didn't recognise, which is useful on a model other than the MFR-3000. Routine refreshes are not logged.

## RECORDING A MACRO

The module supports Companion's action recording. On a button, use the learn (record) option on the action list, then press your source and destination buttons and the salvo switch as you normally would. Each staged or cut route is added as a "Stage a route" or "Cut a route" action, and the salvo switch as "Switch staged crosspoint(s)". Staging the same destination again before a take replaces its earlier action; everything else is kept in the order you did it, including several salvos and clears. Stop recording and the button now repeats that salvo in one press.

Companion's own recording controls are internal actions, which module presets cannot contain, so set up three buttons on a page (the blank module-style preset makes a good macro button):

- A record toggle with the internal actions "Action recorder: set connections" (this connection) then "Action recorder: set recording" (toggle), and the internal "Action recorder: check connections" feedback in state "recording" to light it while recording.
- A button with the internal action "Action recorder: save to button", pointing at the macro button to record onto, to save what was recorded.
- The macro button itself.

Add the salvo switch button press before you stop recording if you want the macro to take the routes as well as stage them.

## VARIABLES

- `id` router unit ID (from the active CPU)
- `level` crosspoint level in use
- `outputs`, `inputs` number of destinations and sources
- `dst##` name of each destination
- `src##` name of each source
- `xpt##` port number of the source routed to each destination
- `xpt##_name` name of the source routed to each destination
- `dst##_locked` lock mode of each destination (0 unlocked, 1 locked, 2 locked by others)
- `auto_route_mode` what happens when a destination and a source are both selected: OFF, STAGE or CUT
- `selected_dst_id`, `selected_dst_name` the selected destination
- `selected_dst_src_id`, `selected_dst_src_name` the source routed to the selected destination
- `selected_src_id`, `selected_src_name` the selected source
- `selected_dst_label`, `selected_src_label` the selected names, or `DST` / `SRC` while nothing is selected (used by the cut and stage buttons)
- `selected_dst_preset_src_id`, `selected_dst_preset_src_name` the source staged for the selected destination
- `selected_dst_lock_action`, `selected_dst_lock_text` what pressing the lock button will do (LOCK or UNLOCK) and ready made button text
- `active_selected_id`, `active_selected_name`, `active_selected_type` the most recent selection (`src` or `dst`)

Selection variables are empty when nothing is selected, and are cleared after a cut.

## PORT NAMES

To edit many names at once, open `/instance/<connection label>/` at Companion's web address, for example `http://127.0.0.1:8000/instance/fora-mfr/`. The table shows each port's name on the router, read at every refresh, so a name changed elsewhere appears within the refresh interval (see the refresh setting; with it off, only after a reconnect). Destinations and sources fold away separately, and a folded section still shows how many changes it has waiting. Type in the New name column or paste into it, then press Apply. Nothing reaches the router until you do, and one bad row sends nothing.

- Paste a column of names to fill downward from the cell you paste into, stopping at the end of that section, or lines such as `DST 1 = Main Mon` or two spreadsheet columns (`DST 1`, then the name) to go to their own ports.
- After Apply each row shows Saved, what the router kept if it changed the name (an MFR tested kept 16 ASCII characters), or No reply.
- Revert last Apply fills the old names back in, for you to Apply. Copy all copies every port and name, to paste into a spreadsheet.
- Anyone who can open Companion's web address can open this page.

## ACTIONS

- Set destination / Set source: make a selection
- Cut selected source to selected destination
- Stage selected source to selected destination
- Switch staged crosspoint(s): perform all staged crosspoints together
- Stage a route / Cut a route: stage or cut one explicit source to destination pair, without using the selection
- Clear staged crosspoint(s): discard all staged routes
- Set auto-route mode: off, stage, cut or the next of these. It is saved in the connection settings, and applies from the next selection, so a pair already selected is not routed by changing the mode
- Preset video format (format, reference and switching point, each of which can be "Use the connection default" set in the connection settings), optionally applied straight away; Apply and Cancel preset video format. These are actions only, with no preset buttons: the router restarts when a new format is accepted and cannot report its current format, so there is no feedback and a stray press is costly.
- Rename a destination or source. The router may shorten a name or drop characters (an MFR tested kept 16 ASCII characters), so the module shows what it reports back and logs a warning if it differs
- Lock / unlock a destination, or toggle the lock of the selected destination

A destination or source option switched to an expression takes the port number shown in the list, so `11` is port 11. The `selected_dst_id`, `selected_src_id` and `xpt##` variables hold the same number, so they can be used there as they are.

Operator actions are sent ahead of the module's own startup reads, but never interrupt a command already waiting for its prompt.

## FEEDBACKS

- Selected destination / Selected source: this port is selected. A selected source flashes while it is the next source for the selected destination
- Routed source: this source is routed to the selected destination
- Routed destination: this destination carries the selected source
- Staged destination / Staged source: a route is staged for this destination, or this source is staged for the selected destination
- Locked destination: this destination is locked
- Auto-route mode: the auto-route mode is the one chosen
- Staged routes waiting: flashes while routes are staged and have not been taken

## PRESETS

- Control: a blank button in the module style, cut, stage, salvo switch, clear staged, lock toggle and auto-route mode buttons. Convert the blank button to a normal button after placing it, so you can add your own actions. The auto-route mode button steps through off, stage (orange) and cut (red: each selection goes live)
- Destinations: a button per destination with select, routed, selected, staged and locked feedback. Destination and source buttons also light up for as long as they are held, which confirms a press in cut straight away mode, where the selection clears at once
- Destinations showing their routed source: a button per destination whose text shows the source currently routed to it, updated live, with a staged route shown beneath it
- Sources: a button per source with select, routed and selected feedback

Not implemented: reinitialize unit, reading back the video format, "lock others" mode.

## COMMAND REFERENCE

## For.A MFR Series 3G/HD/SD/ASI Routing Switchers

     * Basic specification
         -   Port number 49152 - 65534 (default : 23)
         -   Maximum clients : 16
         -   Wait for the prompt, and all reply messages, before sending next command
         -   No password required

## Commands available by connecting using LAN

\*1 When commands are sent via LAN, an Echo, Prompt, S response and other response messages may be included in a single packet or divided into two or more packets. Therefore, do not process commands in a per packet basis but a per stream basis.

\*2 A command protocol should be selected in the [Web-based Control: Port Settings page].

If "Crosspoint remote control 2" is not enabled some functionality is not available.

     *2  To enable "Crosspoint remote control 2" commands
         -   navigate to the switcher's web interface;
             System Settings > Router System Settings > Port Settings
         -   In the TCP/IP section set "Default Function" to "Crosspoint remote control 2"
         -   In the Command Response section make sure that Echo, C and S responses are checked
         -   Send changes in order to save changes to system

## Control command list

## Crosspoint remote control / Crosspoint remote control 2

1.  Commands (S?) for requesting the crosspoints list

        - Control command   =>  @[sp]S?<Lvl>
        - Command response  <=  S:<Lvl><Dest>,<Src>

2.  Commands (X?) for requesting information on crosspoints (by specifying a destination and level.)

        - Control command   =>  @[sp]X?<Lvl><Dest>
        - Command response  <=  S:<Lvl><Dest>,<Src>

3.  Commands (X:) for switching over a crosspoint (single channel)

        - Control command   =>  @[sp]X:<Lvls>/<Dest>,<Src>
        - Command response  <=  S:<Lvl><Dest>,<Src>
                            <=  C:<Lvls>/<Dest>,<Src>[.....[S<Salvo number>][L<Link number>]]:I<ID>

4.  Commands for switching over crosspoints (multi-channel simultaneous switchover)

         - Control command
             Clear a preset crosspoint.  =>  @[sp]B:C
         - Command response

         - Control command
             Preset a crosspoint.    =>  @[sp]P:<Lvl>/<Dest>,<Src>
         - Command response

         - Control command
             Read a preset crosspoint specifying a level and destination.    =>  @[sp]P?<Lvl><Dest>
         - Command response  <=  V:<Lvl><Dest>,<Src>

         - Control command
             Read preset crosspoints for all channels in the specified level.    =>  @[sp]V?<Lvl>
         - Command response  <=  V:<Lvl><Dest>,<Src>

         - Control command
             Perform the preset crosspoints simultaneously.  =>  @[sp]B:E
         - Command response  <=  S:<Lvl><Dest>,<Src>
                             <=  C:<Lvls>/<Dest>,<Src>[.....[S<Salvo number>][L<Link number>]]:I<ID>

5.  Commands (W:) for locking a destination

        - Control command
            LOCK ALL units. =>  @[sp]W:<Lvl>/<Dest>,<ID>,1
        - Command response
                            <=  W!<Lvl><Dest>,<ID>,1

        - Control command
            LOCK OTHER units.   =>  @[sp]W:<Lvl>/<Dest>,<ID>,2
        - Command response
                            <=  W!<Lvl><Dest>,<ID>,2

        - Control command
            Disable LOCK.   =>  @[sp]W:<Lvl>/<Dest>,<ID>,0
        - Command response
                            <=  W!<Lvl><Dest>,<ID>,0

6.  Commands (Z:) for reinitializing a unit

         - Control command   =>  @[sp]Z:<Lvls>
         - Command response  <=  S:<Lvl><Dest>,<Src>
                             <=    C:<Lvls>/<Dest>,<Src>[.....[S<Number of crosspoints in Salvo>][L<Number of Links>]]:I<ID>

7.  Commands (F?) for requesting System Size

        - Control command   =>  @[sp]F?<Lvl>
        - Command response  <=  F:<Lvl><Dst Size>,<Src Size>/< Dst Size >,<Src Size>

## Crosspoint remote control 2 only

7.  Commands (K?) for requesting input/output channel names

        - Control command   =>  @[sp]K?<SorD><AorK>,<Ofset>
        - Command response  <=  K:<SorD><AorK><No.>,<Dat>

8.  Commands (A?) for requesting CPU status.

        - Control command   =>  @[sp]A?
        - Command response
            If CPU is active:   <=  A:<ID>
            If CPU is passive:  <= (no response)

9.  Commands (W?) for requesting Destination Lock status.

        - Control command   =>  @[sp]W?<Lvl>,<Dest>
        - Command response  <=  W!<Lvl><Dest>,<ID>,0-2*
                                *0: Nothing locked
                                1: LOCK ALL
                                2: LOCK OTHER

10. Commands (K:) for importing signal names

        - Control command   =>  K:<SorD><SorLorA><No.>,<Dat>

11. Commands for setting video format (reference and/or switching point).

        - Control command
        Preset video format, reference and switching point. =>  @[sp]UF:<YY>/<R#>,<S$>
        - Command response  <=  UF!<YY>/<R#>,<S$>

        - Control command
        Set preset settings. =>  @[sp]UE:A
        - Command response  <=  UR!W
                            <=  UR!<YY>/<R#>,<S$>
                            <=  UR!E(Error response)

        - Control command
        Cancel preset settings. =>  @[sp]UE:C
        - Command response  <=  UR!C
